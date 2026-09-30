const states = { 'jammu and kashmir':'01', 'himachal pradesh':'02', punjab:'03', chandigarh:'04', uttarakhand:'05', haryana:'06', delhi:'07', rajasthan:'08', 'uttar pradesh':'09', bihar:'10', sikkim:'11', 'arunachal pradesh':'12', nagaland:'13', manipur:'14', mizoram:'15', tripura:'16', meghalaya:'17', assam:'18', 'west bengal':'19', jharkhand:'20', odisha:'21', chhattisgarh:'22', 'madhya pradesh':'23', gujarat:'24', maharashtra:'27', karnataka:'29', goa:'30', lakshadweep:'31', kerala:'32', 'tamil nadu':'33', puducherry:'34', 'andaman and nicobar islands':'35', telangana:'36', 'andhra pradesh':'37', ladakh:'38' };
function supplyState(value) {
  const text = String(value || '').trim().toLowerCase();
  const code = text.match(/^\d{2}$|\((\d{2})\)$/);
  if (code) return code[1] || code[0];
  return states[text.replace(/\s*\([^)]*\)$/, '').trim()] || '';
}
module.exports = { supplyState };
