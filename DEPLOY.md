# 🍿 Popcornn — Production Deployment Guide

This document outlines the step-by-step instructions to deploy the Popcornn signaling server to **Render** and the Next.js web application to **Vercel**.

Because of the circular security dependencies between the client-side domain (CORS origin validation) and the server-side websocket server (Signaling endpoint), the deployment **must be executed in the exact order below**.

---

## 🚀 Step 1: Deploy Signaling Server to Render (Phase 1)

1. Sign in to your **Render** account.
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository containing the Popcornn code.
4. Set the following configuration values (or reference `server/render.yaml`):
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
5. In the **Environment** tab, add these variables:
   - `PORT`: `4000` (or leave default, Render maps this automatically)
   - `CORS_ORIGIN`: `http://localhost:3000` (We will update this placeholder in Step 3)
6. Trigger the deployment.
7. Once deployed, note down the generated Render Service URL (e.g., `https://popcornn-signaling-server.onrender.com`).

---

## 🎨 Step 2: Deploy Frontend to Vercel

1. Sign in to your **Vercel** account.
2. Click **Add New** -> **Project**.
3. Select the same GitHub repository.
4. Set the following configuration values:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: `web`
5. In the **Environment Variables** tab, add the signaling server endpoint:
   - Key: `NEXT_PUBLIC_SIGNAL_URL`
   - Value: `https://popcornn-signaling-server.onrender.com` (Use the Render URL from Step 1)
6. Click **Deploy**.
7. Once compiled and deployed, copy your production Vercel URL (e.g., `https://popcornn.vercel.app`).

---

## 🔒 Step 3: Secure Server CORS (Phase 2)

Now that the Vercel domain exists, we must seal the websocket signaling server so it only accepts connections from our production web application:

1. Return to the **Render** dashboard.
2. Select your `popcornn-signaling-server` service.
3. Navigate to **Environment**.
4. Edit the value of `CORS_ORIGIN`:
   - Old value: `http://localhost:3000`
   - New value: `https://popcornn.vercel.app` (Use the Vercel URL from Step 2)
5. Save the environment changes.
6. Render will automatically trigger a clean redeploy/restart.

Once the redeployment completes, your production Popcornn instance is secure, live, and fully functional!
