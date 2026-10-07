// Zustimmungsseite für den Zugriff von Claude (OAuth über Supabase Auth).
//
// Ablauf: Supabase leitet mit ?authorization_id=… hierher. Ist niemand angemeldet, bekommt die
// Person einen Anmeldelink per E-Mail (keine freie Registrierung: nur vorhandene Konten). Der Link
// führt auf diese Seite zurück, mit derselben authorization_id.
// Danach zeigt die Seite, welche Anwendung Zugriff möchte, und leitet nach Erlauben oder Ablehnen
// an die von Supabase vorgegebene Adresse zurück.

const { url, publishableKey } = window.SUITE_CONFIG;
const supabase = window.supabase.createClient(url, publishableKey, {
  // implicit: Der Link aus der E-Mail funktioniert ohne Zwischenspeicher aus dem ersten Aufruf.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const authorizationId = new URLSearchParams(location.search).get('authorization_id');
const $ = (id) => document.getElementById(id);

function show(step) {
  for (const id of ['step-email', 'step-sent', 'step-consent', 'step-missing']) $(id).hidden = id !== step;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function busy(form, on) {
  for (const button of form.querySelectorAll('button')) button.disabled = on;
}

async function showConsent() {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) {
    showError(`Die Anfrage ist ungültig oder abgelaufen. Bitte in Claude neu verbinden. (${error.message})`);
    return;
  }
  // Schon früher erlaubt: Supabase liefert direkt die Rücksprungadresse.
  if (!('authorization_id' in data)) {
    location.replace(data.redirect_url);
    return;
  }
  $('client-name').textContent = data.client?.name || 'Eine Anwendung';
  $('user-email').textContent = data.user?.email ?? '';
  $('redirect-uri').textContent = data.redirect_uri ?? '';
  show('step-consent');
}

async function decide(approve) {
  showError('');
  $('approve').disabled = $('deny').disabled = true;
  const options = { skipBrowserRedirect: true };
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
    : await supabase.auth.oauth.denyAuthorization(authorizationId, options);
  if (error || !data?.redirect_url) {
    showError(error?.message ?? 'Keine Rücksprungadresse erhalten. Bitte in Claude neu verbinden.');
    $('approve').disabled = $('deny').disabled = false;
    return;
  }
  location.assign(data.redirect_url);
}

$('email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  busy(event.target, true);
  const email = $('email').value.trim();
  const emailRedirectTo = `${location.origin}${location.pathname}?authorization_id=${encodeURIComponent(authorizationId)}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
  busy(event.target, false);
  if (error) {
    showError(`Anmeldelink konnte nicht gesendet werden: ${error.message}`);
    return;
  }
  $('sent-to').textContent = email;
  show('step-sent');
});

$('back').addEventListener('click', () => {
  showError('');
  show('step-email');
});
$('approve').addEventListener('click', () => decide(true));
$('deny').addEventListener('click', () => decide(false));

(async () => {
  if (!authorizationId) {
    show('step-missing');
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await showConsent();
  else show('step-email');
})();
