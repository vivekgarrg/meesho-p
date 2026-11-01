# Rudam bot on WhatsApp — labels at 5 PM and 8 PM

After each automatic labels run, the app sends the sorted labels PDF to your
WhatsApp numbers through Meta's **WhatsApp Business Cloud API** (the official
API, free to set up; Meta charges per conversation — a "utility" message to an
Indian number costs well under ₹1).

## 1. Meta business and app (once, ~20 minutes)

1. Go to <https://business.facebook.com> and create (or pick) the business
   account for Rudam.
2. Go to <https://developers.facebook.com/apps> → **Create app** → type
   **Business** → add the **WhatsApp** product, linked to that business.
3. **WhatsApp → API setup**: add a phone number for the bot. Use a number that
   is **not** already on WhatsApp or the WhatsApp Business app (a new SIM, or
   delete WhatsApp from it first). Verify it by SMS/call. Set the display name
   "Rudam" (Meta reviews it, usually within a day).
4. Note the **Phone number ID** shown there → `WHATSAPP_PHONE_NUMBER_ID`.
5. Add a payment method under the WhatsApp account (Business settings →
   WhatsApp accounts → Payment settings); without it Meta stops after the free
   test messages.

## 2. A permanent token

The token on the API setup page expires in 24 hours. For a permanent one:

1. Business settings → **Users → System users** → Add → role **Admin**.
2. **Add assets** → your app (full control) and your WhatsApp account (full control).
3. **Generate new token** → pick the app → expiry **Never** → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy it → `WHATSAPP_TOKEN`. Keep it secret (it can send as your number).

## 3. The message template

A message the business starts must use an approved template.

WhatsApp Manager → **Message templates** → Create:

- Category: **Utility**
- Name: `rudam_labels` (→ `WHATSAPP_TEMPLATE`), language **English** (→ `WHATSAPP_TEMPLATE_LANG=en`)
- Header: **Document**
- Body: `Rudam labels: {{1}}` (one variable — the app fills in the time, count and businesses)
- Sample for {{1}}: `Meesho labels — 5:00 PM, 1 Nov — 42 labels from Rudam, Cosmify Mart`

Submit; approval usually takes minutes to a few hours.

## 4. Who receives it

`WHATSAPP_TO` — numbers with country code, no `+`, separated by commas:
`WHATSAPP_TO=919812345678,919900000001`

While the app is in development mode, add each number under API setup → "To"
→ Manage phone number list. Once the app is live (App Mode: Live) any number works.

## 5. Put it on the server

In `/home/deploy/meesho-p/deploy/hostinger/.env`:

```
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1098765...
WHATSAPP_TEMPLATE=rudam_labels
WHATSAPP_TEMPLATE_LANG=en
WHATSAPP_TO=919812345678
```

Then restart both: `sudo systemctl restart meesho meesho-sidekiq`.

## 6. Switch it on in the app

Meesho → **Settings → Automation**:

1. **Make labels at**: add **5:00 PM** and **8:00 PM**, Save schedule.
2. **Switch on** the automation (if it isn't).
3. **Send the labels to WhatsApp** → **Start sending** (the button only works
   once the server has the settings above).

At 5 PM and 8 PM the worker accepts pending orders, makes the labels, sorts
them by parent SKU, keeps them under "Latest labels" — and sends the PDF.

## Test it once by hand (on the server)

```
cd ~/meesho-p/backend && source .venv/bin/activate && set -a && source ../deploy/hostinger/.env && set +a
python manage.py shell -c "from meesho_app import notify; print(notify.channels()); print(notify.send('Rudam test', 'hello', filename='test.pdf', data=open('/path/to/any.pdf','rb').read()))"
```

`{'whatsapp': 'sent'}` means it works. An error carries Meta's reason, e.g.
"Template name does not exist" (not approved yet / wrong name or language) or
"Recipient phone number not in allowed list" (step 4, development mode).
