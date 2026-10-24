# Samrosa — new starter project

A new, separate Node.js + Express + PostgreSQL app inspired by Samrosa's food-surplus workflow. It does not modify the original repository.

## What's included

- Responsive HTML/CSS/JavaScript dashboard
- Donor directory
- Recipient directory
- Donation intake form and donation ledger
- Dashboard counts for donations, pounds, donors, and recipients
- Express API with basic input validation
- PostgreSQL tables created automatically on server startup
- One Render Web Service can serve both the frontend and API; a separate Render PostgreSQL database stores data

## Requirements

- Node.js 20+
- PostgreSQL for local development

## Run locally

1. Open this folder in VS Code.
2. Open VS Code Terminal → New Terminal.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a PostgreSQL database named `samrosa`.
5. Copy `.env.example` to `.env`.
6. Edit `.env` and set `DATABASE_URL` to your local PostgreSQL connection string.
7. Start the app:

   ```bash
   npm start
   ```

8. Visit `http://localhost:3000`.

The server creates the tables on startup. Keep `.env` private; never commit database credentials.

## Deploy on Render

### A. Create the PostgreSQL database

1. Sign in to https://dashboard.render.com.
2. Click **New + → PostgreSQL**.
3. Enter a name such as `samrosa-db`.
4. Choose a region.
5. Choose an available plan and review the price and limitations.
6. Click **Create Database**.
7. Once it is ready, open the database and copy its **Internal Database URL**.

### B. Deploy this app as a Web Service

1. Push this project folder to a new GitHub repository.
2. In Render, click **New + → Web Service**.
3. Connect GitHub and choose the new repository.
4. Set **Runtime/Language** to Node if prompted.
5. Set **Build Command** to `npm install`.
6. Set **Start Command** to `npm start`.
7. Choose a plan and click **Create Web Service**.
8. After the service is created, open **Environment** and add:
   - `DATABASE_URL` = the PostgreSQL Internal Database URL
   - `NODE_ENV` = `production`
9. Save the changes and wait for the redeploy.
10. Open the public `onrender.com` URL. Visit `/api/health` to check the API and database connection.

The database and web service should be in the same Render region so the internal database URL can be used.

## Important limitations

This is a functional learning/demo starter, not a production-ready donation or tax-compliance system. It does not implement user accounts, authentication, role permissions, verified nonprofit status, food-safety checks, audited tax receipts, or formal tax advice. Do not store sensitive donor information or use its values as tax advice. Before real use, add authentication/authorization, stronger operational validation, migrations/backups, logging, and security review.

## Project layout

```text
samrosa-new/
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── src/server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```
