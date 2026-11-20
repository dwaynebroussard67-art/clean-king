// Validate server action input; database independently enforces the same limits.
export function parseAssistantSettings(form){
 const one=key=>{const vals=form.getAll(key);return vals.length===1&&typeof vals[0]==='string'?vals[0]:null};
 const name=one('owner_name')?.trim(),provider=one('provider'),persona=one('persona'),minute=one('per_minute'),month=one('per_month'),counts=form.getAll('include_counts');
 if(!name||name.length>40||/[\u0000-\u001f\u007f-\u009f]/.test(name)||!['anthropic','open'].includes(provider)||!['enthusiastic','calm'].includes(persona)||!/^\d{1,3}$/.test(minute||'')||!/^\d{1,3}$/.test(month||'')||Number(minute)<1||Number(minute)>3||Number(month)<1||Number(month)>100||counts.length>1||(counts.length===1&&counts[0]!=='on'))return null;
 return {p_name:name,p_provider:provider,p_persona:persona,p_counts:counts.length===1,p_minute:Number(minute),p_month:Number(month)};
}
