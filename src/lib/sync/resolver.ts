export type ResolutionIndex = { publishCrm?:boolean; domains:{companyId:string;domain:string}[]; people:{email:string;companyId:string|null}[]; deals:{id:string|null;companyId:string;blocked?:boolean}[]; aliases?:{companyId:string;name:string}[]; rules?:{email:string;companyId:string;dealId:string|null}[] };
export function resolveParticipants(addresses:string[], index:ResolutionIndex,subject="") {
  const candidates=new Set<string>();let inferred=false;
  for(const raw of addresses) {
    const email=raw.trim().toLowerCase();
    const learned=index.rules?.find(rule=>rule.email.toLowerCase()===email);
    if(learned){candidates.add(learned.companyId);continue;}
    const exact=index.people.filter(p=>p.email.toLowerCase()===email&&p.companyId).map(p=>p.companyId!);
    const domain=email.split("@")[1];
    for(const company of exact.length ? exact : index.domains.filter(d=>d.domain.toLowerCase()===domain).map(d=>d.companyId)) candidates.add(company);
  }
  if(!candidates.size && subject) for(const alias of index.aliases??[]) {if(alias.name.trim().length>=5 && subject.toLowerCase().includes(alias.name.toLowerCase())) {candidates.add(alias.companyId);inferred=true;}}
  const ids=[...candidates].sort();
  const companyId=ids.length===1?ids[0]:null;
  const deals=companyId?index.deals.filter(d=>d.companyId===companyId):[];
  // Never guess a round when a company has several active opportunities.
  const blocked=deals.some(d=>d.blocked);
  const learnedDeals=(index.rules??[]).filter(rule=>addresses.some(email=>email.toLowerCase()===rule.email.toLowerCase())&&rule.companyId===companyId&&rule.dealId).map(rule=>rule.dealId);
  const dealId=!blocked && new Set(learnedDeals).size===1 ? learnedDeals[0] : !blocked&&deals.length===1?deals[0].id:null;
  return {companyId:blocked||inferred?null:companyId,dealId,candidates:ids,status:blocked||inferred?"review" as const:companyId ? "matched" as const : ids.length ? "review" as const : "ignored" as const};
}
