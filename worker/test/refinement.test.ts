import test from "node:test";
import assert from "node:assert/strict";
import { validateRefinement, contextPayload, words, refinementConfigured, generateRefinement } from "../src/refinement.ts";

const line = (seq:number,text:string,speaker:number|null=0) => ({seq,text,speaker,start:seq,end:seq+1,channel:0,language:"en",languages:",en,"});
const sources=[line(1,"We might invite Mira."),line(2,"To the workshop but we have not committed to Friday.")];
const valid=()=>({cleaned:[{sources:[1,2],text:"We might invite Mira to the workshop, but we have not committed to Friday."}],notes:[{kind:"discussion",en:"An invitation is tentative; Friday is not committed.",ja:"招待は検討中で、金曜日は未確定です。",evidence:[{seq:2,quote:"we have not committed to Friday"}]}],terms:[]});
test("sentence repairs join same-speaker chunks without overwriting originals",()=>{
 const before=JSON.stringify(sources),result=validateRefinement(valid(),sources);
 assert.equal(result.cleaned[0].change,"formatting"); assert.equal(JSON.stringify(sources),before);
});
test("negation, amounts, uncertainty and names changing are wording drafts, never auto-accepted",()=>{
 for(const [raw,changed] of [["We have not agreed.","We have agreed."],["Maybe Friday.","Friday."],["Pay 15 dollars.","Pay 50 dollars."],["Invite Mira.","Invite Mina."],["Visa payment.","Mira payment."]]){
  const result=validateRefinement({cleaned:[{sources:[1],text:changed}],notes:[],terms:[]},[line(1,raw)]);
  assert.equal(result.cleaned[0].change,"wording");
 }
 assert.notEqual(words("can't"),words("cant"));
 assert.notEqual(words("1.5"),words("15"));
 assert.notEqual(words("no where"),words("nowhere"));
 assert.notEqual(words("50%"),words("50"));
});
test("sources must cover every chunk exactly once, in order",()=>{
 for(const ids of [[1],[2,1],[1,1],[1,3],[]]){const v=valid();v.cleaned[0].sources=ids;assert.throws(()=>validateRefinement(v,sources));}
});
test("no merging different or unknown speakers/channels",()=>{
 for(const rows of [[sources[0],line(2,sources[1].text,1)],[line(1,sources[0].text,null),line(2,sources[1].text,null)],[sources[0],{...sources[1],channel:1}]])assert.throws(()=>validateRefinement(valid(),rows));
});
test("unknown channels cannot be merged even when speaker numbers match",()=>{
 assert.throws(()=>validateRefinement(valid(),sources.map(l=>({...l,channel:null}))));
});
test("a refinement endpoint, credential and model must all be explicitly bound",async()=>{
 for(const env of [{},{REFINEMENT_URL:"https://example.invalid"},{REFINEMENT_URL:"https://example.invalid",REFINEMENT_TOKEN:"synthetic"}]){
  assert.equal(refinementConfigured(env as any),false);
  await assert.rejects(generateRefinement(env as any,"synthetic",{lines:[]}),/not configured/);
 }
 assert.equal(refinementConfigured({REFINEMENT_URL:"https://example.invalid",REFINEMENT_TOKEN:"synthetic",REFINEMENT_MODEL:"synthetic"} as any),true);
});
test("unsupported note/term citations and unbounded payloads fail closed",()=>{
 for(const evidence of [[],[{seq:9,quote:"Friday"}],[{seq:2,quote:"we committed to Friday"}]]){const v=valid();v.notes[0].evidence=evidence;assert.throws(()=>validateRefinement(v,sources));}
 const v=valid();v.cleaned[0].text="x".repeat(16001);assert.throws(()=>validateRefinement(v,sources));
 assert.throws(()=>validateRefinement({cleaned:[],notes:[],terms:[]},sources));
});
test("Japanese, negation, and bilingual source links remain distinct from study definitions",()=>{
 const raw="稟議はまだ通っていません。Visaで払うかもしれません。";
 const result=validateRefinement({cleaned:[{sources:[1],text:raw}],notes:[],terms:[{term:"稟議",reading:"りんぎ",meaning:"Internal approval process",evidence:[{seq:1,quote:"稟議"}]}]},[line(1,raw)]);
 assert.equal(result.cleaned[0].text,raw);assert.equal(result.terms[0].evidence[0].quote,"稟議");
});
test("only active, explicitly saved vocabulary enters model context; raw is data",()=>{
 const base={id:"synthetic",term:"Mira",original:"Mirror",reading:"",meaning:"fictional colleague",created:0,retracted:null,reviews:0,last_rating:null,last_review:null};
 const payload=contextPayload(sources,[{...base,active:1},{...base,term:"inactive",active:0}],"Meeting context");
 assert.deepEqual(payload.confirmed_vocabulary,[{term:base.term,original:base.original,reading:"",meaning:base.meaning}]);
 assert.equal(payload.lines,sources);
});
