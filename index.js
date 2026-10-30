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

// Скачиваем ffmpeg для Linux
const ffmpegPath = path.join(__dirname, 'ffmpeg');
if (!fs.existsSync(ffmpegPath)) {
  console.log("Downloading ffmpeg...");
  const file = fs.createWriteStream(ffmpegPath);
  https.get('https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/ffmpeg-linux-x64', (response) => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      fs.chmodSync(ffmpegPath, '755');
      console.log("ffmpeg downloaded!");
    });
  });
}

const EFFECTS = {
  speedup: ['-filter:a', 'atempo=1.25'],
  slowed:  ['-filter:a', 'atempo=0.85,asetrate=44100*0.85,aresample=44100,aecho=0.8:0.9:1000:0.3'],
  reverb:  ['-filter:a', 'aecho=0.8:0.88:60:0.4'],
  '8d':    ['-filter:a', 'apulsator=hz=0.08,aecho=0.8:0.9:1000:0.3'],
};

const label = (e) => ({ speedup: "⚡ Speed Up", slowed: "🐢 Slowed+Reverb", reverb: "🌊 Reverb", "8d": "🎧 8D" }[e] || e);

bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (msg.text === '/start') {
    return bot.sendMessage(chatId, "🎵 *Аудио-эффекты*\n\nОтправь аудио/голосовое — выбери эффект:", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Speed Up", callback_data: "fx:speedup" }, { text: "🐢 Slowed", callback_data: "fx:slowed" }],
          [{ text: "🌊 Reverb", callback_data: "fx:reverb" }, { text: "🎧 8D", callback_data: "fx:8d" }],
        ],
      },
    });
  }

  if (msg.audio || msg.voice) {
    const fileId = (msg.audio || msg.voice).file_id;
    bot.fileCache = bot.fileCache || {};
    bot.fileCache[chatId] = fileId;

    return bot.sendMessage(chatId, "Выбери эффект:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Speed Up", callback_data: "fx:speedup" }, { text: "🐢 Slowed", callback_data: "fx:slowed" }],
          [{ text: "🌊 Reverb", callback_data: "fx:reverb" }, { text: "🎧 8D", callback_data: "fx:8d" }],
        ],
      },
    });
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const effect = query.data.split(':')[1];

  bot.answerCallbackQuery(query.id, "Обрабатываю...");
  bot.editMessageText(`⏳ *${label(effect)}*...`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" });

  const fileId = bot.fileCache?.[chatId];
  if (!fileId) return bot.sendMessage(chatId, "❌ Файл устарел, отправь заново.");

  try {
    const fileLink = await bot.getFileLink(fileId);
    const inputPath = `/tmp/${Date.now()}_in.mp3`;
    const outputPath = `/tmp/${Date.now()}_out.mp3`;

    const response = await fetch(fileLink);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(arrayBuffer));

    execFile(ffmpegPath, ['-y', '-i', inputPath, ...EFFECTS[effect], '-b:a', '192k', outputPath], async (err) => {
      if (err) {
        console.error(err);
        return bot.sendMessage(chatId, "❌ Ошибка ffmpeg.");
      }

      await bot.sendAudio(chatId, outputPath, { title: `Track [${label(effect)}]` });
      bot.editMessageText(`✅ Готово: *${label(effect)}*`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" });

      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Ошибка: " + e.message);
  }
});
