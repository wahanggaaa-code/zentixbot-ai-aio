// UN member states, the two UN observers, plus Taiwan and Kosovo for geographic coverage.
// Codes use ISO 3166-1 alpha-2 except XK (customary Kosovo code); names use Node's Intl.
import { randomInt } from 'node:crypto';
export const FACT_COUNTRIES=Object.freeze('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'.split(' '));
const ALLOWED=new Set(FACT_COUNTRIES),names=new Intl.DisplayNames(['en'],{type:'region'});
export const factCountryName=code=>code==='PS'?'Palestine':code==='VA'?'Vatican City':names.of(code);

// Shuffle a full bag using unbiased crypto.randomInt. The last draw is avoided at
// a cycle boundary; failed searches still consume a draw so errors cannot stick on one country.
export function nextFactCountries(old,randomBelow=randomInt){
 const isValid=list=>Array.isArray(list)&&list.length<=FACT_COUNTRIES.length&&new Set(list).size===list.length&&list.every(c=>ALLOWED.has(c));
 let remaining=isValid(old?.remaining)?[...old.remaining]:[];
 const previous=isValid(old?.picked)?old.picked.slice(0,3):[];
 const picked=[];
 while(picked.length<3){
  if(!remaining.length){
   const bag=[...FACT_COUNTRIES];
   for(let i=bag.length-1;i>0;i--){const j=randomBelow(i+1);if(!Number.isInteger(j)||j<0||j>i)throw new Error('Invalid random selection');[bag[i],bag[j]]=[bag[j],bag[i]];}
   // The exclusion only changes order, so all countries remain in the new cycle.
   const excluded=new Set([...previous,...picked]);
   remaining=[...bag.filter(c=>!excluded.has(c)),...bag.filter(c=>excluded.has(c))];
  }
  picked.push(remaining.shift());
 }
 return {remaining,picked};
}
