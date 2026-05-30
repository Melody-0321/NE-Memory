// @name         NE Test
// @version      0.0.1
console.log('[NE_TEST] Script loaded, checking environment...');
console.log('[NE_TEST] typeof $:', typeof $);
console.log('[NE_TEST] typeof TavernHelper:', typeof TavernHelper);
console.log('[NE_TEST] typeof SillyTavern:', typeof SillyTavern);
console.log('[NE_TEST] document.readyState:', document.readyState);
console.log('[NE_TEST] __NE_MEMORY_LOADED__:', typeof window.__NE_MEMORY_LOADED__);
window.__NE_MEMORY_LOADED__ = true;
console.log('[NE_TEST] Boot check complete.');
