# Simple RSS Monitor

A Node.js application to monitor RSS feeds and send notifications to Discord and Telegram.

## Features

- Add and manage RSS feeds.
- Configure check intervals for each feed.
- Select specific fields from RSS items for notifications.
- Integrate with Discord (webhooks) and Telegram (bots).
- Real-time UI updates using Socket.IO.


## Setup and Run

1.  **Clone the repository (or create files as per structure).**
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Configure environment variables (if any - e.g., for default ports, API keys if not managed via UI).**
    Create a `.env` file if needed.
4.  **Start the application:**
    ```bash
    npm start
    ```
    (Assuming a start script like `"start": "node server/app.js"` in `package.json`)


