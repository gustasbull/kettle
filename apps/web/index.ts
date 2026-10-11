/** Minimal account entry. Website login and ChatGPT authorization remain separate. */
export const website = (authConfigured = false) => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Riff</title><style>body{font:18px/1.6 system-ui;max-width:40rem;margin:12vh auto;padding:24px;color:#292721;background:#faf8f1}h1{font-size:3rem}</style>
<main><h1>Riff</h1><p>Turn creator context into video ideas and scripts you can film.</p>
${authConfigured ? '<p><a href="/auth/sign-in">Sign in to Riff</a> · <a href="/auth/sign-up">Create an account</a> · <a href="/account">Your account</a></p><p>Connect ChatGPT separately after signing in. This development build has no public listing.</p>' : '<p>This development build is ready for connectivity testing. Sign-in requires an identity provider configuration.</p>'}
<a href="/health">Check service health</a></main></html>`;
