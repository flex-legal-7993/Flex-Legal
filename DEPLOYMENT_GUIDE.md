# Flex Legal Services — Intake System Deployment Guide
## Windows — No Developer Experience Required

---

## What You're Deploying

- **The chatbot** — what clients see at intake.flexlegalteam.com
- **The backend server** — invisible to clients; fills your Word templates and emails your paralegal
- **Both run on Render** — one account, ~$7/month

---

## Before You Start — Checklist

Have these ready:
- [x] Your Anthropic API key — **you have this**
- [x] GitHub account — **flex-legal-7993 — you have this**
- [ ] GitHub Desktop installed (desktop.github.com)
- [ ] A Gmail App Password for jstubbs@flexlegalteam.com (see Step 2 below)
- [ ] The flex-legal-system folder saved on your computer
- [ ] A free Render account (render.com)

---

## Step 1 — Install GitHub Desktop (5 minutes)

GitHub Desktop is the app that connects your computer to your GitHub account (flex-legal-7993) and lets you push code to Render with a few clicks.

1. Go to **desktop.github.com**
2. Download and install GitHub Desktop
3. Sign in with your GitHub account: **flex-legal-7993**

---

## Step 2 — Create a Gmail App Password for jstubbs@flexlegalteam.com (5 minutes)

This lets the server send email through your Google Workspace account without using your real password. You'll do this from the Google account linked to jstubbs@flexlegalteam.com.

1. Go to your Google Account: **myaccount.google.com**
2. Click **Security** in the left menu
3. Under "How you sign in to Google," click **2-Step Verification** (must be turned on first)
4. Scroll to the bottom — click **App passwords**
5. Under "App name," type: **Flex Legal Intake**
6. Click **Create**
7. Google shows you a 16-character password — **copy it and save it** (you won't see it again)

---

## Step 3 — Upload Your Code to GitHub (5 minutes)

1. Open **GitHub Desktop**
2. Click **File → Add Local Repository**
3. Browse to the **flex-legal-system** folder on your computer → click **Add Repository**
   - If it says "not a git repository," click **Create a Repository** instead, point it to the same folder
4. You'll see all the files listed. In the bottom-left box, type: **Initial upload**
5. Click **Commit to main**
6. Click **Publish repository** (top right)
   - Uncheck "Keep this code private" if you want (the API keys are in Render, not in the code)
   - Click **Publish Repository**

Your code is now on GitHub.

---

## Step 4 — Deploy to Render (10 minutes)

1. Go to **render.com** and sign up (free)
2. Click **New +** → **Web Service**
3. Click **Connect a repository** → connect your GitHub account
4. Select your **flex-legal-intake** repository
5. Fill in these settings:
   - **Name:** flex-legal-intake
   - **Region:** Oregon (US West) — closest to Utah
   - **Branch:** main
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Starter ($7/month)
6. Click **Advanced** → **Add Environment Variable** — add these one by one:

   | Key | Value |
   |-----|-------|
   | `ANTHROPIC_API_KEY` | Your Anthropic API key |
   | `GMAIL_USER` | jstubbs@flexlegalteam.com |
   | `GMAIL_APP_PASSWORD` | The 16-character password from Step 2 |
   | `NOTIFY_EMAIL` | jstubbs@flexlegalteam.com (beta testing — update to paralegal email when ready to go live) |

7. Click **Create Web Service**
8. Render will build and deploy — takes about 3 minutes
9. When it says **Live**, copy your URL — it looks like: `https://flex-legal-intake.onrender.com`

---

## Step 5 — Connect the Chatbot to Your Server (2 minutes)

1. Open the **flex-legal-system/public/index.html** file in Notepad
2. Find this line near the top of the `<script>` section:
   ```
   const BACKEND_URL = 'https://YOUR-RENDER-APP.onrender.com';
   ```
3. Replace `YOUR-RENDER-APP` with your actual Render app name, e.g.:
   ```
   const BACKEND_URL = 'https://flex-legal-intake.onrender.com';
   ```
4. Save the file
5. In **GitHub Desktop**, you'll see the change listed
6. Type **Update backend URL** in the commit box → **Commit to main** → **Push origin**
7. Render will automatically redeploy (takes ~2 minutes)

---

## Step 6 — Test the System (5 minutes)

1. Go to your Render URL: `https://flex-legal-intake.onrender.com`
2. You should see the Flex Legal chatbot with the consent screen
3. Check the checkbox and click **Begin My Estate Plan**
4. Have a test conversation using fake information:
   - Say you're married
   - Use a fake name like "Test Client"
   - Complete the full intake
5. Check **jstubbs@flexlegalteam.com** — a populated Word document should arrive within about 30 seconds
6. Open the Word doc and confirm all the merge fields were filled correctly

**When beta testing is complete:** Go to Render → Environment Variables → update `NOTIFY_EMAIL` to your paralegal's email address. No redeployment needed — takes effect immediately.

**If the email doesn't arrive:** Check your spam folder first. If still missing, see Troubleshooting below.

---

## Step 7 — Point intake.flexlegalteam.com to Render (5 minutes)

Ask your web manager to add a CNAME DNS record:

| Type | Name | Value |
|------|------|-------|
| CNAME | intake | flex-legal-intake.onrender.com |

Then in Render:
1. Go to your service → **Settings** → **Custom Domains**
2. Click **Add Custom Domain**
3. Enter: `intake.flexlegalteam.com`
4. Render will verify it — takes up to 24 hours for DNS to propagate

---

## You're Live

The full pipeline is now running:
1. Client visits intake.flexlegalteam.com
2. Chatbot collects all information
3. Server fills your Word template automatically
4. Populated draft lands in your paralegal's inbox
5. Paralegal reviews → forwards to you → you approve → signing scheduled

---

## Troubleshooting

**"Something went wrong" in the chatbot**
→ Check that your Render service is running (green dot in Render dashboard)
→ Check that ANTHROPIC_API_KEY is set correctly in Render environment variables

**No email received**
→ Check spam folder
→ Confirm GMAIL_USER and GMAIL_APP_PASSWORD are correct in Render
→ Make sure 2-Step Verification is enabled on the Gmail account (required for App Passwords)

**Word document has blank fields**
→ The chatbot didn't collect that field — check the conversation log in Render (Dashboard → Logs)
→ If a field name changed in your template, update the mergeData section in server.js

**Render shows "Sleeping" (free tier)**
→ Upgrade to Starter ($7/month) — the free tier sleeps after 15 minutes of inactivity, which causes a slow first response

---

## Adding New Documents Later

When you're ready to add POA, healthcare directive, or trust amendment templates:

1. Add your Word template to the **templates/** folder
2. In server.js, add a new route or extend the existing logic to generate that document
3. Commit and push via GitHub Desktop — Render deploys automatically

Your paralegal doesn't need to do anything differently — the new document will just appear as an additional attachment in the email.

---

## Monthly Cost Summary

| Service | Cost |
|---------|------|
| Render (Starter) | $7/month |
| Anthropic API | ~$0.10–0.50/month at your volume |
| Gmail | Already paying |
| **Total** | **~$8/month** |

---

*Flex Legal Services LLC — Confidential System Documentation*
