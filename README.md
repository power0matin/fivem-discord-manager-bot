# Nox RP Stream Notifier (Discord Bot)

یک بات دیسکورد برای **اعلان استریم‌های Nox RP** روی **Kick** و **Twitch**.

این بات هر _X_ ثانیه پلتفرم‌ها را چک می‌کند و اگر یک استریم:

- **Game/Category = Grand Theft Auto V (GTA V)** باشد
- و داخل **Title** عبارت **Nox RP** (یا Regex دلخواه شما) وجود داشته باشد

در یک چنل مشخص پیام می‌فرستد و (اختیاری) `@here` و منشن صاحب استریم را هم انجام می‌دهد.


## GitHub Repo پیشنهاد شده

### اسم Repo (پیشنهادی)

- `nox-rp-stream-notifier`

### اسم پروژه داخل README

- **Nox RP Stream Notifier**

### Description (برای قسمت About در GitHub)

> Discord bot that monitors Kick & Twitch for GTA V streams with "Nox RP" in the title and posts @here + stream link in a Discord channel.

### Topics (پیشنهادی)

```
discord
discord-bot
discordjs
nodejs
twitch
kick
gtav
gta-v
roleplay
rp
stream-notifier
oauth2
polling
```

### License

- **MIT**


## امکانات (Features)

- ✅ نگهداری لیست استریمرهای Kick و Twitch
- ✅ چک کردن خودکار هر X ثانیه (Polling)
- ✅ فیلتر دقیق:
  - فقط **GTA V**
  - فقط Title شامل **Nox RP** (Regex قابل تنظیم)
- ✅ پیام اعلان داخل چنل مشخص:
  - `@here` (قابل خاموش/روشن)
  - لینک استریم
  - منشن کردن Discord User (اگر هنگام add کردن منشن داده باشید)
- ✅ کامندهای شبیه نمونه‌ای که فرستادید:
  - `.k add / .k remove / .k list`
  - `.t add / .t remove / .t list`
  - `.tick` برای چک دستی
- ✅ ذخیره لیست و وضعیت اعلان‌ها داخل `data.json` (خودکار ساخته می‌شود)


## نمونه پیام اعلان

```text
@here <@DiscordUserId> 🔴 **lionkiiing** الان لایو شد روی **Kick**
🎮 **Grand Theft Auto V**
📝 Nox RP | ...
https://kick.com/lionkiiing
```

> اگر `@here` پینگ نمی‌دهد، مشکل از Permission های بات داخل چنل است (پایین توضیح داده شده).


## پیش‌نیازها

- Node.js **18+**
- یک Discord Bot Token
- Twitch Developer App (Client ID & Secret)
- Kick Developer App (Client ID & Secret)


## 1) ساخت Discord Bot و گرفتن Token

1. وارد Discord Developer Portal شوید
2. **New Application** بسازید
3. از تب **Bot**:
   - **Add Bot** را بزنید
   - Token را **Reset / Copy** کنید
4. از همان تب Bot، این Intent را فعال کنید:
   - ✅ **Message Content Intent** (چون کامندها Prefix دار هستند)

### Permission های لازم در چنل

بات باید در چنل اعلان این Permission ها را داشته باشد:

- View Channel
- Send Messages
- Read Message History
- **Mention Everyone** (برای اینکه `@here` واقعاً پینگ کند)


## 2) ساخت Twitch App (Client ID / Secret)

- در Twitch Developer Console یک Application بسازید و `Client ID` و `Client Secret` را بردارید.
- این بات از **Client Credentials Grant** استفاده می‌کند (یعنی نیاز به لاگین استریمرها ندارد).


## 3) ساخت Kick App (Client ID / Secret)

- در Kick Developer داشبورد یک اپ بسازید و `Client ID` و `Client Secret` بگیرید.
- این بات از **client_credentials** برای گرفتن App Token استفاده می‌کند.


## نصب و اجرا (Local)

```bash
npm install
cp .env.example .env
# فایل .env را پر کنید
npm start
```

اولین بار که اجرا شود، یک فایل `data.json` کنار پروژه می‌سازد و لیست‌ها را آنجا نگه می‌دارد.


## تنظیمات (.env)

فایل `.env.example` را ببینید. مهم‌ترین متغیرها:

### متغیرهای ضروری

- `DISCORD_TOKEN` : توکن بات
- `DISCORD_NOTIFY_CHANNEL_ID` : آیدی چنلی که اعلان‌ها داخلش ارسال شود

### Twitch

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_GTA5_GAME_ID` (پیش‌فرض `32982`)

### Kick

- `KICK_CLIENT_ID`
- `KICK_CLIENT_SECRET`
- `KICK_GTA_CATEGORY_NAME` (پیش‌فرض `Grand Theft Auto V`)

### تنظیمات رفتار بات

- `PREFIX` (پیش‌فرض `.`)
- `CHECK_INTERVAL_SECONDS` (پیش‌فرض `60`)
- `MENTION_HERE` (پیش‌فرض `true`) → اگر `false` شود، @here ارسال نمی‌کند
- `KEYWORD_REGEX` (پیش‌فرض `nox\s*rp`) → Regex برای تشخیص Nox RP در Title

### Discovery Mode (اختیاری)

این حالت بدون لیست، بین استریم‌های GTA V دنبال Title شامل Keyword می‌گردد (مصرف API بیشتر):

- `DISCOVERY_MODE=false|true`
- `DISCOVERY_TWITCH_PAGES=5` (هر صفحه تا 100 استریم)
- `DISCOVERY_KICK_LIMIT=100` (Kick فعلاً حداکثر 100)

> پیشنهاد: برای استفاده واقعی، **لیست استریمرها** را نگه دارید و Discovery را خاموش کنید.


## کامندهای دیسکورد

> نکته: اجرای کامندها نیاز به Permission **Manage Server** دارد (بات این را چک می‌کند).

### Kick

- اضافه کردن:
  - `.k add <kickSlug> [@discordUser]`
  - یا کوتاه: `.k <kickSlug> [@discordUser]`
- حذف:
  - `.k remove <kickSlug>`
- لیست:
  - `.k list`

### Twitch

- اضافه کردن:
  - `.t add <twitchLogin> [@discordUser]`
  - یا کوتاه: `.t <twitchLogin> [@discordUser]`
- حذف:
  - `.t remove <twitchLogin>`
- لیست:
  - `.t list`

### چک دستی

- `.tick`

### راهنما

- `.help`


## دیتابیس و ذخیره‌سازی

- فایل `data.json` کنار پروژه ذخیره می‌شود و شامل:
  - لیست Kick/Twitch
  - تنظیمات
  - وضعیت اینکه برای یک لایو چند بار اعلان داده نشود (anti-spam)

> `data.json` داخل `.gitignore` است و نباید commit شود.


## Deploy روی VPS (پیشنهادی با PM2)

1. روی سرور:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/nox-rp-stream-notifier.git
cd nox-rp-stream-notifier
npm install
cp .env.example .env
nano .env   # مقداردهی کنید
```

2. نصب و اجرای pm2:

```bash
npm i -g pm2
pm2 start src/index.js --name nox-rp-stream-notifier
pm2 save
pm2 startup
```


## Troubleshooting

### بات کامندها را نمی‌خواند

- Message Content Intent را در Discord Developer Portal فعال کنید
- مطمئن شوید Prefix درست است (`PREFIX`)

### @here پینگ نمی‌دهد

- بات در آن چنل Permission **Mention Everyone** لازم دارد
- اگر نمی‌خواهید پینگ کند: `MENTION_HERE=false`

### Twitch/Kick کار نمی‌کند

- Client ID/Secret را درست وارد کرده باشید
- Rate Limit: `CHECK_INTERVAL_SECONDS` را بیشتر کنید (مثلاً 120 یا 180)


## مشارکت (Contributing)

Pull Request و Issue خوش‌آمد است.  
فقط لطفاً **هیچوقت** `.env` یا Token ها را داخل Repo نگذارید.


## License

MIT (فایل `LICENSE` را ببینید) — مقدار `YOUR_NAME` را به اسم خودتان تغییر دهید.
