# QuickPOS launch runbook

The repository is ready for a website, subscription backend, and R2 release
channel. The remaining steps require account credentials and signing keys and
must be completed by an operator with access to Vercel, Cloudflare, Paystack,
Flutterwave, Resend, and the GitHub repository.

## 1. Deploy the website

Create a Vercel project with `packages/website` as its root directory. Use the
Vite preset, `npm run build` as the build command, and `dist` as the output
directory.

Set:

```text
VITE_RELEASE_MANIFEST_URL=https://downloads.quickpos.name.ng/latest.json
```

Add these GitHub Actions secrets to enable
`.github/workflows/deploy-website.yml`:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_WEBSITE_PROJECT_ID
```

Attach both `quickpos.name.ng` and `www.quickpos.name.ng` to the website
project. In Cloudflare DNS, add the exact A/CNAME targets displayed by Vercel
for those domains. Keep the records DNS-only while Vercel verifies and issues
HTTPS certificates. Redirect `www` to the apex domain in Vercel.

Vercel domain guide:
https://vercel.com/docs/domains/working-with-domains/add-a-domain

## 2. Create the download service

Create a private Cloudflare R2 bucket for installers. Connect the custom domain
`downloads.quickpos.name.ng` from the R2 bucket settings. Do not enable the
temporary `r2.dev` URL for production distribution.

Allow public `GET` and `HEAD` access through the custom domain. Configure CORS
for:

```text
https://quickpos.name.ng
https://www.quickpos.name.ng
```

Create an R2 API token scoped to this bucket and add these GitHub Actions
secrets:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

The release workflow uploads immutable files to `releases/<version>/`, writes
the Electron Windows updater channel to `desktop/windows/`, and replaces
`latest.json` only after all files and checksums have uploaded successfully.

Cloudflare R2 custom-domain guide:
https://developers.cloudflare.com/r2/buckets/public-buckets/#connect-a-bucket-to-a-custom-domain

## 3. Configure subscription providers

Create recurring monthly, quarterly, and yearly plans in both providers:

| Plan | Amount | Interval |
| --- | ---: | --- |
| Monthly | NGN 5,000 | Monthly |
| Quarterly | NGN 13,500 | Every 3 months |
| Yearly | NGN 50,000 | Yearly |

The required five-month NGN 20,000 initial activation is initialized as a
one-time payment and does not need a provider plan.

After adding valid provider keys to `.env`, create or reuse the exact recurring
plans and print their environment values:

```bash
npm run billing:configure
```

To write the generated plan identifiers into the local `.env` file:

```bash
npm run billing:configure -- --write=.env
```

Set the production server environment variables from `.env.example`, including
the provider plan codes/IDs.

Register these webhook URLs:

```text
https://<api-domain>/api/v1/billing/webhooks/paystack
https://<api-domain>/api/v1/billing/webhooks/flutterwave
```

Use the same Flutterwave secret hash in
`FLUTTERWAVE_WEBHOOK_SECRET`. QuickPOS verifies provider signatures, verifies
successful transactions with the provider API, and de-duplicates webhook
events before changing access.

Provider references:

- https://paystack.com/docs/payments/subscriptions/
- https://paystack.com/docs/payments/webhooks/
- https://developer.flutterwave.com/docs/payment-plans
- https://developer.flutterwave.com/docs/webhooks

## 4. Configure email

Verify a sending domain in Resend and set:

```text
RESEND_API_KEY
EMAIL_FROM=QuickPOS <billing@quickpos.name.ng>
EMAIL_REPLY_TO=support@quickpos.name.ng
```

Configure a real mailbox or Cloudflare Email Routing destination for
`support@quickpos.name.ng`; Resend sending-domain verification does not create
an inbox.

Set `CRON_SECRET` on the server. Vercel invokes
`/api/v1/jobs/subscription-reminders` daily at 08:00 UTC for renewal and
expiry messages.

Resend domain guide:
https://resend.com/docs/dashboard/domains/introduction

Password recovery also uses Resend. Set:

```text
PASSWORD_RESET_URL=https://quickposs.vercel.app/#/reset-password
PASSWORD_RESET_EXPIRY_MINUTES=30
```

## 5. Migrate and verify the backend

Deploy the server changes and run:

```bash
npm run db:migrate
```

Migration `002_subscriptions` marks all existing stores as `grandfathered`.
Migration `003_password_resets` adds hashed, expiring, single-use password
reset tokens.
Review those stores manually before changing their status. Public seed
credentials have been removed; optional seed credentials must be supplied
through `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

Verify:

1. Two owner registrations create different stores in pending activation.
2. Owners and managers can create only permitted staff inside their store.
3. New stores receive `402 INITIAL_ACTIVATION_REQUIRED` for mutations until
   the ₦20,000 activation is verified.
4. Expired stores receive `402 SUBSCRIPTION_EXPIRED` for mutations.
5. Reports, statement PDF/Excel, printing, statement email, and billing remain
   available after expiry.
6. Duplicate and invalid-signature webhooks do not change access.

## 6. Publish Windows and Android

Add Android signing secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_STORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Optional Windows signing secrets:

```text
WINDOWS_CSC_LINK
WINDOWS_CSC_KEY_PASSWORD
```

Run **Build and publish QuickPOS releases** from GitHub Actions with a semantic
version, release notes, and minimum supported version. Keep macOS and Linux
inputs disabled for the initial release. The Android job verifies the release
signature before upload, and the manifest generator refuses debug or unsigned
artifact filenames.

For later macOS publication, add:

```text
MAC_CSC_LINK
MAC_CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

Only enable macOS publication after the DMG can be signed and notarized.
iPhone distribution must use TestFlight or the App Store, not a direct IPA.
