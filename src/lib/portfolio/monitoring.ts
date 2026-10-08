export type WatchRule={id:string;investment_id:string;metric:string;unit:string;minimum:number|null;maximum:number|null;stale_after_days:number};
export type MetricObservation={investment_id:string;metric:string;unit:string;value:number;observed_on:string};
export function evaluateWatchRules(rules:WatchRule[],observations:MetricObservation[],now=new Date()) {
  return rules.map(rule=>{
    const latest=observations.filter(row=>row.investment_id===rule.investment_id&&row.metric===rule.metric&&row.unit===rule.unit&&row.observed_on<=now.toISOString().slice(0,10)).sort((a,b)=>b.observed_on.localeCompare(a.observed_on))[0];
    const age=latest?Math.floor((now.getTime()-Date.parse(`${latest.observed_on}T00:00:00Z`))/86400000):null;
    const outside=latest&&((rule.minimum!==null&&Number(latest.value)<Number(rule.minimum))||(rule.maximum!==null&&Number(latest.value)>Number(rule.maximum)));
    return {rule,latest:latest??null,age,status:!latest?"missing" as const:age!>rule.stale_after_days?"stale" as const:outside?"watch" as const:"within range" as const};
  });
}
