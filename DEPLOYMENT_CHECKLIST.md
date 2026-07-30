# Deployment Checklist for Firebase FCM on Render

## Step 1: Obtain Firebase Service Account Credentials
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your StockMind project
3. Go to **Project Settings** (gear icon) → **Service Accounts**
4. Click **Generate new private key** (under Firebase Admin SDK)
5. Save the downloaded JSON file securely

## Step 2: Extract Required Environment Variables
From the downloaded JSON file, extract:
- `project_id` → `FIREBASE_PROJECT_ID`
- `client_email` → `FIREBASE_CLIENT_EMAIL`
- `private_key` → `FIREBASE_PRIVATE_KEY`

## Step 3: Configure Environment Variables on Render Dashboard
1. Go to your Render dashboard → StockMind service → Environment
2. Add the following variables:
   - `FIREBASE_PROJECT_ID`: [your project ID]
   - `FIREBASE_CLIENT_EMAIL`: [your client email]
   - `FIREBASE_PRIVATE_KEY`: [private key value with \n for newlines]

   **Important**: The private key must be formatted with literal `\n` characters (not actual newlines). 
   Example: If the private key in the JSON is:
   ```
   -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...\n-----END PRIVATE KEY-----\n
   ```
   Then set the environment variable value to exactly that string (including the `\n` literals).

## Step 4: Verify Deployment
After deploying with the above environment variables, run the health check:

```bash
curl https://stockmind-api-vmht.onrender.com/api/v1/health
```

Expected JSON response (partial):
```json
{
  "status": "ok",
  "timestamp": "2026-07-31T01:00:00.000Z",
  "services": {
    "firebase": "configured",
    // ... other services
  }
}
```

## Step 5: Test FCM Functionality
1. Register a device token via the `/notifications/register-device` endpoint (requires auth)
2. Trigger a stock operation (inbound/outbound/adjustment) to send a notification
3. Verify the notification appears on the registered device

## Troubleshooting
- If Firebase shows as "not configured" in health check, double-check the environment variable values and formatting.
- Check service logs for Firebase initialization errors.