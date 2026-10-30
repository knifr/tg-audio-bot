const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const { execFile } = require('child_process');
const https = require('https');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Скачиваем ffmpeg
const ffmpegPath = path.join(__dirname, 'ffmpeg');
if (!fs.existsSync(ffmpegPath)) {
  console.log("Downloading ffmpeg...");
  const file = fs.createWriteStream(ffmpegPath);
  https.get('https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64', (response) => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      fs.chmodSync(ffmpegPath, '755');
      console.log("ffmpeg downloaded!");
    });
  }).on('error', (err) => {
    console.log("Ошибка скачивания ffmpeg: ", err.message);
  });
}

// --- МЕНЮ ---
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "⚡ Speed Up", callback_data: "menu:speedup" }, { text: "🐢 Slowed", callback_data: "menu:slowed" }],
      [{ text: "🌊 Reverb", callback_data: "fx:reverb" }, { text: "🎧 8D", callback_data: "fx:8d" }],
    ],
  }
};

const speedupKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "1.10x", callback_data: "fx:spd_110" }, { text: "1.20x", callback_data: "fx:spd_120" }, { text: "1.25x", callback_data: "fx:spd_125" }],
      [{ text: "1.30x", callback_data: "fx:spd_130" }, { text: "1.35x", callback_data: "fx:spd_135" }, { text: "1.50x", callback_data: "fx:spd_150" }],
      [{ text: "⬅️ Назад", callback_data: "menu:main" }],
    ],
  }
};

const slowedKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "0.90x", callback_data: "fx:slw_90" }, { text: "0.85x", callback_data: "fx:slw_85" }, { text: "0.80x", callback_data: "fx:slw_80" }],
      [{ text: "0.75x", callback_data: "fx:slw_75" }, { text: "0.70x", callback_data: "fx:slw_70" }],
      [{ text: "⬅️ Назад", callback_data: "menu:main" }],
    ],
  }
};

bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (msg.text === '/start') {
    return bot.sendMessage(chatId, "🎵 *Аудио-эффекты*\n\nОтправь аудио/голосовое — выбери эффект:", {
      parse_mode: "Markdown",
      ...mainKeyboard
    });
  }

  if (msg.audio || msg.voice || msg.document) {
    const fileObj = msg.audio || msg.voice || msg.document;
    bot.fileCache = bot.fileCache || {};
    
    let ext = '.mp3';
    if (fileObj.mime_type && fileObj.mime_type.includes('m4a')) ext = '.m4a';
    if (fileObj.mime_type && fileObj.mime_type.includes('ogg')) ext = '.ogg';
    
    bot.fileCache[chatId] = { fileId: fileObj.file_id, ext: ext };

    return bot.sendMessage(chatId, "Выбери эффект:", mainKeyboard);
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (data === "menu:main") {
    bot.answerCallbackQuery(query.id);
    return bot.editMessageReplyMarkup(mainKeyboard.reply_markup, { chat_id: chatId, message_id: messageId });
  }
  if (data === "menu:speedup") {
    bot.answerCallbackQuery(query.id);
    return bot.editMessageReplyMarkup(speedupKeyboard.reply_markup, { chat_id: chatId, message_id: messageId });
  }
  if (data === "menu:slowed") {
    bot.answerCallbackQuery(query.id);
    return bot.editMessageReplyMarkup(slowedKeyboard.reply_markup, { chat_id: chatId, message_id: messageId });
  }

  let effectName = "";
  let filterArgs = [];

  if (data === "fx:reverb") {
    effectName = "🌊 Reverb";
    filterArgs = ['-af', 'aecho=0.8:0.88:60:0.4'];
  } else if (data === "fx:8d") {
    effectName = "🎧 8D";
    filterArgs = ['-af', 'apulsator=hz=0.08,aecho=0.8:0.9:1000:0.3'];
  } else if (data.startsWith("fx:spd_")) {
    const val = parseFloat(data.split('_')[1]) / 100;
    effectName = `⚡ Speed Up ${val}x`;
    filterArgs = ['-af', `atempo=${val}`];
  } else if (data.startsWith("fx:slw_")) {
    const val = parseFloat(data.split('_')[1]) / 100;
    effectName = `🐢 Slowed ${val}x`;
    const setrate = Math.round(44100 * val);
    filterArgs = ['-af', `asetrate=${setrate},aresample=44100,atempo=0.95,aecho=0.8:0.9:1000:0.3`];
  } else {
    return bot.answerCallbackQuery(query.id, "Неизвестный эффект");
  }

  bot.answerCallbackQuery(query.id, "Обрабатываю...");
  bot.editMessageText(`⏳ *${effectName}*...`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" });

  const fileData = bot.fileCache?.[chatId];
  if (!fileData) return bot.sendMessage(chatId, "❌ Файл устарел, отправь заново.");

  try {
    const fileLink = await bot.getFileLink(fileData.fileId);
    const timestamp = Date.now();
    const inputPath = `/tmp/${timestamp}_in${fileData.ext}`;
    const outputPath = `/tmp/${timestamp}_out.mp3`;

    // Скачиваем исходник
    const response = await fetch(fileLink);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(arrayBuffer));

    // Запускаем ffmpeg (формат mp3, битрейт 128k)
    execFile(ffmpegPath, ['-y', '-i', inputPath, '-vn', ...filterArgs, '-b:a', '128k', '-f', 'mp3', outputPath], async (err) => {
      
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

      if (err) {
        console.error(err);
        return bot.sendMessage(chatId, "❌ Ошибка ffmpeg. Возможно, файл поврежден.");
      }

      // Ждем 1 секунду, чтобы файловая система точно записала файл на диск
      setTimeout(async () => {
        try {
          // Принудительно отправляем как поток (createReadStream)
          await bot.sendAudio(chatId, fs.createReadStream(outputPath), {
            title: `Track [${effectName}]`,
            performer: "Audio Bot",
            caption: `✅ Готово: *${effectName}*`,
            parse_mode: "Markdown"
          });
          
          bot.editMessageText(`✅ Готово: *${effectName}*`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" });
        } catch (sendErr) {
          console.error("Ошибка отправки:", sendErr);
          bot.sendMessage(chatId, "❌ Ошибка при отправке готового файла. " + sendErr.message);
        } finally {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
      }, 1000); // Задержка 1 секунда
      
    });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Ошибка: " + e.message);
  }
});
