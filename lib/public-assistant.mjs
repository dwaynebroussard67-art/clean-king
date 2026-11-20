// Deliberately deterministic: no provider, identity, network, business database or eval.
// Intent matching is intentionally narrow. Unknown questions get no invented facts.
export function publicAnswer(message, language) {
  if (typeof message !== 'string' || !['en','es'].includes(language)) return null;
  const q=message.trim();
  if (!q || q.length>500) return null;
  const es=language==='es';
  const math=q.match(/^\s*(-?\d{1,7}(?:\.\d{1,3})?)\s*([+\-*/×÷])\s*(-?\d{1,7}(?:\.\d{1,3})?)\s*=?\s*$/u);
  if(math){
    const a=Number(math[1]),b=Number(math[3]),op=math[2];
    if((op==='/'||op==='÷')&&b===0)return es?'No se puede dividir entre cero.':'Division by zero is not defined.';
    const value=op==='+'?a+b:op==='-'?a-b:op==='*'||op==='×'?a*b:a/b;
    if(!Number.isFinite(value)||Math.abs(value)>1e14)return es?'El resultado está fuera del límite.':'That result is outside the supported range.';
    const formatted=new Intl.NumberFormat(es?'es-US':'en-US',{maximumFractionDigits:6,useGrouping:false}).format(value);
    return es?`Resultado aproximado: ${formatted}. No es un precio ni una cotización.`:`Approximate result: ${formatted}. This is not a price or quote.`;
  }
  const text=q.toLowerCase();
  if(/\b(apply|application|job|hiring|solicitar|solicitud|empleo|trabajo)\b/u.test(text)) return es?'Puedes explorar la página de solicitud en /apply. Si está desactivada, no se recibe ninguna solicitud.':'Explore the application page at /apply. If it is disabled, no application is received.';
  if(/\b(quote|estimate|price|pricing|cost|cotización|cotizacion|presupuesto|precio)\b/u.test(text))return es?'Puedes visitar /quote. Los servicios y precios deben confirmarse; no puedo dar una cotización.':'Visit /quote. Services and prices need confirmation; I cannot provide a quote.';
  if(/\b(service|services|cleaning|servicio|servicios|limpieza)\b/u.test(text))return es?'La sección de servicios ofrece ejemplos; el dueño debe confirmar el alcance y la disponibilidad.':'The services section shows examples; the owner must confirm scope and availability.';
  if(/\b(referral|refer|invite|invitation|referencia|invitación|invitacion)\b/u.test(text))return es?'Una invitación de referencia no da acceso a datos personales. Las invitaciones reales aún no están disponibles en producción.':'A referral invitation does not give access to personal information. Real invitations are not currently available in production.';
  return es?'Puedo orientar sobre solicitudes, servicios, cotizaciones o referencias, y calcular operaciones simples como 12 * 5. No compartas datos personales.':'I can guide you about applications, services, quotes or referrals, and calculate simple expressions such as 12 * 5. Please do not share personal information.';
}

export function createPublicAssistantHandler(){
 return async request=>{
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'Invalid request.'},415);
  const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request.'},400);
  let size=0,chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply({error:'Request too large.'},413)}chunks.push(value)}
   const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length}
   const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
   if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).sort().join(',')!=='language,message')return reply({error:'Invalid request.'},400);
   const answer=publicAnswer(input.message,input.language);return answer?reply({answer}):reply({error:'Invalid request.'},400);
  }catch{return reply({error:'Invalid request.'},400)}
 };
}
