// Synthetic attested.network vector in the shape live atprotofans proofs use
// (checked against pds.atmosphere.money proofs on 2026-11-13): the proof's
// `cid` commits to the payment without `signatures`, plus `$sig: {repo: payer}`.
import { cidForLex } from '../../app/node_modules/@atproto/lex-cbor/dist/index.js';
import { writeFileSync } from 'node:fs';
const payer = 'did:plc:fan';
const broker = 'did:plc:7srqsetux75b6flzbbyag2ro';
const payment = {$type:'network.attested.payment.oneTime',subject:'did:plc:artist',amount:2500,currency:'USD',txnid:'fixture-1',createdAt:'2026-11-12T00:00:00Z',entitlements:[]};
const attestationCid = String(await cidForLex({...payment,$sig:{repo:payer}}));
const value = {$type:'network.attested.payment.proof',status:'verified',cid:attestationCid};
const cid = String(await cidForLex(value));
const uri = `at://${broker}/network.attested.payment.proof/3abc`;
payment.signatures = [{uri,cid},{uri:'at://did:plc:irrelevant/network.attested.payment.proof/3abc',cid}];
writeFileSync(new URL("../src/internal/space/fixtures/attested.json", import.meta.url),JSON.stringify({page:{records:[{uri:`at://${payer}/network.attested.payment.oneTime/3abc`,value:payment}]},proof:{uri,cid,value}},null,2)+'\n');
