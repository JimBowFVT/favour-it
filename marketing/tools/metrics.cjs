const fs = require('node:fs');
const DAY = 86400000;
function timestamp(value, label) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp with a time zone`);
  return Date.parse(value);
}
function unique(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error(`${label} must have unique nonempty IDs`);
    ids.add(row.id);
  }
}
function rate(numerator, denominator) { return { numerator, denominator, rate: denominator ? numerator / denominator : null }; }
function median(values) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b); const middle=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
function measure(input) {
  if (input.source !== 'verified-server-export') throw new Error('Use reviewed server records, not browser click events');
  const asOf=timestamp(input.asOf,'asOf');
  for(const key of ['members','orders','needs','assistance']) if(!Array.isArray(input[key]))throw new Error(`Missing ${key} array`);
  unique(input.members,'Members');unique(input.orders,'Orders');unique(input.needs,'Needs');
  const memberMap=new Map();
  for(const member of input.members){
    const accepted=timestamp(member.acceptedAt,'acceptedAt');
    if(!member.isTest && accepted<=asOf) memberMap.set(member.id,{...member,accepted});
  }
  const members=[...memberMap.values()];
  const orders=[];
  for(const order of input.orders){
    if(order.isTest||order.reversed||order.status!=='completed')continue;
    if(order.serverVerified!==true)throw new Error('Completed orders must be explicitly verified against the server');
    if(order.isTest!==false||order.reversed!==false)throw new Error('Review and explicitly set test and reversal flags for completed orders');
    const created=timestamp(order.createdAt,'order createdAt'); const completed=timestamp(order.completedAt,'completedAt');
    if(completed<created)throw new Error('Order completion precedes creation');
    if(order.buyerId===order.sellerId)throw new Error('Self-orders cannot count as marketplace activity');
    if(completed>asOf||!memberMap.has(order.buyerId)||!memberMap.has(order.sellerId))continue;
    if(!/^\d+$/.test(String(order.serviceAmountMicroFav)))throw new Error('FAV amounts must be nonnegative integer micro-FAV strings');
    orders.push({...order,created,completed});
  }
  orders.sort((a,b)=>a.completed-b.completed);
  let activationEligible=0,activated=0,repeatEligible=0,repeated=0,loops=0,transacting=0;
  const firstTimes=[]; const bySource=Object.create(null);
  for(const member of members){
    const participated=orders.filter(o=>(o.buyerId===member.id||o.sellerId===member.id)&&o.created>=member.accepted);
    const first=participated[0];
    const source=member.source||'unknown';
    bySource[source] ||= {accepted:0,activationEligible:0,activated:0,transacting:0};
    bySource[source].accepted++;
    if(asOf-member.accepted>=30*DAY){
      activationEligible++;bySource[source].activationEligible++;
      if(first&&first.completed-member.accepted<=30*DAY){activated++;bySource[source].activated++;}
    }
    if(first){
      transacting++;bySource[source].transacting++;firstTimes.push((first.completed-member.accepted)/DAY);
      if(asOf-first.completed>=30*DAY){repeatEligible++;if(participated.slice(1).some(o=>o.completed-first.completed<=30*DAY))repeated++;}
      const firstSale=participated.find(o=>o.sellerId===member.id);
      if(firstSale&&participated.some(o=>o.buyerId===member.id&&o.created>firstSale.completed))loops++;
    }
  }
  let needsEligible=0,matched=0;
  for(const need of input.needs){
    if(need.isTest||!memberMap.has(need.memberId))continue;
    const submitted=timestamp(need.submittedAt,'submittedAt');
    const accepted=need.matchedAt?timestamp(need.matchedAt,'matchedAt'):null;
    if(accepted!==null&&accepted<submitted)throw new Error('Match precedes request');
    if(asOf-submitted>=7*DAY){needsEligible++;if(accepted!==null&&accepted-submitted<=7*DAY)matched++;}
  }
  const countedOrderIds=new Set(orders.map(o=>o.id));
  let assistanceMinutes=0;
  for(const entry of input.assistance){
    const at=timestamp(entry.at,'assistance at');
    if(!Number.isFinite(entry.minutes)||entry.minutes<0)throw new Error('Assistance minutes must be nonnegative');
    if(at<=asOf&&!entry.isTest&&countedOrderIds.has(entry.orderId))assistanceMinutes+=entry.minutes;
  }
  const volume=orders.reduce((sum,o)=>sum+BigInt(o.serviceAmountMicroFav),0n);
  const fav=`${volume/1000000n}.${String(volume%1000000n).padStart(6,'0')}`;
  return {
    asOf:input.asOf,acceptedMembers:members.length,completedOrders:orders.length,transactingMembers:transacting,
    activation30Days:rate(activated,activationEligible),repeat30Days:rate(repeated,repeatEligible),
    matchedWithin7Days:rate(matched,needsEligible),earnThenSpendMembers:loops,
    medianDaysToFirstCompletion:median(firstTimes),orderAssistanceMinutes:assistanceMinutes,
    meanAssistanceMinutesPerCompletedOrder:orders.length?assistanceMinutes/orders.length:null,
    serviceVolumeMicroFav:volume.toString(),serviceVolumeFav:fav,
    earnedSpendProvenance:input.earnedSpendProvenance||null,bySource,
    notes:['Rates include only fully observed 30-day or 7-day windows.','Only completed, server-verified, non-test, non-reversed orders between reviewed members count.','Earn-then-spend is a journey proxy: sale completion precedes the later purchase creation. It does not prove which ledger bucket funded the purchase.','FAV volume is not cash revenue. Assistance includes only logged work linked to counted orders.'],
  };
}
module.exports={measure};
if(require.main===module){
  const [inputPath,outputPath]=process.argv.slice(2);
  if(!inputPath||!outputPath){console.error('Usage: node marketing/tools/metrics.cjs reviewed-input.json metrics-output.json');process.exitCode=1;}
  else {
    try {
      const report = measure(JSON.parse(fs.readFileSync(inputPath,'utf8')));
      fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
      console.log('Metrics written. No messages sent and no database changes made.');
    } catch(e) { console.error(e.message);process.exitCode=1; }
  }
}
