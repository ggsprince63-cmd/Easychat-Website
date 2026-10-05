# EasyChat Room

Chat rooms by code + an AI "Send AI-generated reply" button with a confirm step.

## Run it
1. Install Node.js 18+ (https://nodejs.org)
2. In this folder run:  `npm install`
3. Copy `.env.example` to `.env` and paste your Gemini key (https://aistudio.google.com/apikey).
   Without a key the app still runs and gives a sample "demo" reply.
4. `npm start`  → open http://localhost:3000

## Try it
Open the site in two browser windows (or two devices on the same Wi-Fi: http://YOUR-PC-IP:3000),
enter different names and the SAME room code. Messages appear live in both.
Click "✨ Send AI-generated reply" under a received message → preview → Confirm & Send.

## Notes
- Rooms live in memory; they disappear when the server restarts (last 50 messages kept while running).
- The API key stays on the server, never in the browser.
- To use it with friends over the internet, deploy to a Node host (Render, Railway, Fly.io) and set the
  same variables there.
