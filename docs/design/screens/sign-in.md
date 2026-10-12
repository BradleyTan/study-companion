# Screen: Sign in (`/login`)

**Layout:** centred sticker card (max 420 px) on graph paper, washi tape across the top edge, Permanent Marker title "Open your notebook". Phone: full width with 16 px gutter.

**Content:** email field + "Email me a sign-in link" (primary). Divider "or". "Continue with Google" (plain), shown only when `NEXT_PUBLIC_GOOGLE_SIGNIN=1`. Footer links: Privacy.
**Demo mode** (no Supabase configured, dev/preview only): a highlighted note "Demo mode: data lives in memory and resets when the server restarts" and a "Try the demo" primary button instead of the email/Google options.

**States**
- Sending: button text "Sending…", disabled.
- Sent: card swaps to "Check your inbox ✉️" with the email shown and "Use a different email".
- Error: inline message under the field ("That doesn't look like an email address." / "We couldn't send the link. Try again in a minute."), `boop` sound, field gets `aria-invalid`.

**Sounds:** `click` on buttons, `pop` when the link is sent.
