# Authoring assets

Source artwork used to generate the deployment-ready files in `web/public/`.

- `ui/` contains slots, arrows, logos, castbar art, the heretic animation, and
  inventory frames.
- `avatars/` contains the animated inventory portrait pool.
- `emoji/` contains Slack-ready emoji organized by pack.

Run `npm run assets --prefix web` after changing anything here. The generated
files in `web/public/` are committed so Vercel can build without uploading the
authoring library.
