// OWNER: Worker 3. Placeholder from the scaffold: proves the preload bridge works.
const status = document.getElementById('status');

try {
  const settings = await window.proxy.settings.get();
  status.textContent = `Bridge OK. Answer style: ${settings.answerStyle}, send mode: ${settings.sendMode}.`;
} catch (err) {
  status.textContent = `Bridge failed: ${err.message}`;
}
