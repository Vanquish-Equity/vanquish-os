export type DocumentClassification={typeId:string|null;categoryId:string|null;status:"RECEIVED"|"UNKNOWN";date:string|null;confidence:"rule"|"review"};
export function classifyDocument(name:string,text:string,types:{id:string;category_id:string;name:string;code:string}[]):DocumentClassification {
  const normalize=(value:string)=>value.toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  const content=normalize(`${name}\n${text.slice(0,50000)}`);
  const aliases:Record<string,string[]>={pitch_deck:["pitch deck","investor presentation"],nda:["non disclosure agreement","nondisclosure agreement"],safe:["simple agreement for future equity"],cap_table:["capitalization table","cap table"],financial_statements:["financial statements"]};
  const found=types.filter(type=>[normalize(type.name),normalize(type.code),...(aliases[type.code.toLowerCase()]??[])].some(term=>term.length>=4&&content.includes(term)));
  const dates=[...(`${name}\n${text.slice(0,10000)}`).matchAll(/(?<!\d)(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])(?!\d)/g)].map(match=>`${match[1]}-${match[2]}-${match[3]}`);
  const uniqueDates=[...new Set(dates)].filter(date=>new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date);
  return {typeId:found.length===1?found[0].id:null,categoryId:found.length===1?found[0].category_id:null,status:"RECEIVED",date:uniqueDates.length===1?uniqueDates[0]:null,confidence:found.length===1?"rule":"review"};
}
