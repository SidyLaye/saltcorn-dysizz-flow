const assert = require('node:assert/strict');
const { recent, resoudreContact } = require('../src/lib/leads/contact');
const { identifierSite } = require('../src/lib/leads/extraire');
(async () => {
  const a = { id: 1, cree_le: '2026-09-28T09:00:00+02:00' };
  const b = { id: 2, cree_le: '2026-09-28T08:00:00Z' };
  assert.equal(recent([a, b, {id: 999, cree_le: 'invalide'}]).id, 2);
  const crm = { contactsParEmail: async () => [a, b], contactsParTelephone: async () => [{id: 99, cree_le: '2026-09-29'}] };
  assert.equal((await resoudreContact({email:'test@example.test',telephone:'+33600000001'}, crm)).contact.id, 2);
  await assert.rejects(resoudreContact({email:'test@example.test'}, {...crm, contactsParEmail: async () => {throw new Error('CRM indisponible');}}), /CRM indisponible/);
  await assert.rejects(resoudreContact({telephone:'+33600000001'}, {...crm, contactsParTelephone: async () => null}), /invalide/);
  const sites = [{domaine:'agence.test',libelle:'Agence Exemple'}];
  assert.equal(identifierSite(['https://fausseagence.test/bien'], '', '', sites), null);
  assert.equal(identifierSite(['https://biens.agence.test:443/bien'], '', '', sites).libelle, 'Agence Exemple');
  console.log('Contacts : priorité email, vrais instants, erreurs bloquantes ; sites : domaines exacts et sous-domaines OK');
})().catch(e => {console.error(e); process.exitCode=1;});
