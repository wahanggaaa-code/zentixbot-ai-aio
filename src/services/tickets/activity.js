const TYPES=new Set(['created','claimed','unclaimed','transferred','closed','reopened','priority','tags','deleted']);
const ids=/^\d{17,20}$/;
const PRIORITIES=new Set(['none','low','medium','high','urgent']);
// The event and the ticket state share one optimistic write; no message content or tag values are copied.
export function appendTicketActivity(ticket,{type,actorId,from,to,at=new Date().toISOString()}){
 if(!TYPES.has(type)||!ids.test(actorId||'')||!Number.isFinite(Date.parse(at)))throw Object.assign(Error('Invalid ticket activity'),{code:'TICKET_ACTIVITY_INVALID'});
 if(ticket.ticketActivity!==undefined&&!Array.isArray(ticket.ticketActivity))throw Object.assign(Error('Stored ticket activity is invalid'),{code:'TICKET_ACTIVITY_INVALID'});
 const event={type,at,actorId};
 if(type==='transferred'||type==='unclaimed'){if(ids.test(from||''))event.from=from;}
 if(type==='transferred'){if(!ids.test(to||''))throw Error('Invalid transfer target');event.to=to;}
 if(type==='priority'){if(PRIORITIES.has(from))event.from=from;if(PRIORITIES.has(to))event.to=to;}
 ticket.ticketActivity=[...(ticket.ticketActivity||[]),event].slice(-50);
}
