'use client';
import { useActionState, useEffect, useState } from 'react';
import { createInvitation } from './actions';
const text={
 en:{language:'Español',label:'DEVELOPMENT TEST ONLY',title:'Invite someone to join our team.',intro:'Create a one-use invitation and share it yourself. Applications and hiring decisions stay private.',created:'Invitations created',submitted:'Applications submitted',unavailable:'Referral totals are unavailable.',create:'Create invitation',creating:'Creating…',copyNow:'Copy this link now; it cannot be shown again. It can be used once and expires:',link:'Invitation link',code:'Code for manual entry',privacy:'Share only with the person you invite. Anyone with this link can use it once. It does not share your personal information or access theirs.',copy:'Copy link',copied:'Link copied.',copyFail:'Copy unavailable. Select the link above to copy it.',share:'Share invitation',shareText:'We’re hiring! Use my invitation link to apply.',shareFail:'Sharing was cancelled or unavailable. You can copy the link instead.',test:'This test uses temporary sign-in. Do not use real personal data.',error:'Could not create an invitation. Check your account or try again later.'},
 es:{language:'English',label:'SOLO PARA PRUEBAS',title:'Invita a alguien a unirse al equipo.',intro:'Crea una invitación de un solo uso y compártela tú mismo. Las solicitudes y decisiones de contratación son privadas.',created:'Invitaciones creadas',submitted:'Solicitudes enviadas',unavailable:'Los totales de referencias no están disponibles.',create:'Crear invitación',creating:'Creando…',copyNow:'Copia este enlace ahora; no se puede volver a mostrar. Se puede usar una vez y vence:',link:'Enlace de invitación',code:'Código para ingresar manualmente',privacy:'Compártelo solo con la persona invitada. Cualquiera con el enlace puede usarlo una vez. No comparte tus datos personales ni accede a los de esa persona.',copy:'Copiar enlace',copied:'Enlace copiado.',copyFail:'No se pudo copiar. Selecciona el enlace para copiarlo.',share:'Compartir invitación',shareText:'¡Estamos contratando! Usa mi enlace para solicitar.',shareFail:'Se canceló o no se pudo compartir. Puedes copiar el enlace.',test:'Esta prueba usa acceso temporal. No uses información personal real.',error:'No se pudo crear la invitación. Revisa tu cuenta o intenta más tarde.'}
};
export default function InviteForm({created,submitted,totalsError}) {
  const [state, action, pending] = useActionState(createInvitation, {});
  const [lang,setLang]=useState('en'), [message,setMessage]=useState(''), [canShare,setCanShare]=useState(false); const t=text[lang];
  useEffect(()=>{document.documentElement.lang=lang;return()=>{document.documentElement.lang='en'}},[lang]);
  useEffect(()=>{setCanShare(typeof navigator.share==='function')},[]);
  async function copy(){try{await navigator.clipboard.writeText(state.link);setMessage(t.copied)}catch{setMessage(t.copyFail)}}
  async function share(){try{await navigator.share({text:t.shareText,url:state.link});setMessage('')}catch{setMessage(t.shareFail)}}
  return <>
    <div className="public-language"><button onClick={()=>setLang(lang==='en'?'es':'en')}>{t.language}</button></div>
    <div className="mini-label">{t.label}</div><h1>{t.title}</h1><p className="public-intro">{t.intro}</p>
    {totalsError ? <p>{t.unavailable}</p> : <p>{t.created}: {created} · {t.submitted}: {submitted}</p>}
    <form action={action}><button className="btn dark" disabled={pending}>{pending ? t.creating : t.create}</button></form>
    {state.error && <p className="form-error" role="alert">{t.error}</p>}
    {state.link && <div className="public-form">
      <p>{t.copyNow} <time dateTime={state.expires}>{new Date(state.expires).toLocaleString(lang==='es'?'es':'en')}</time>.</p>
      <label>{t.link}<input readOnly value={state.link} onFocus={e=>e.target.select()}/></label>
      <label>{t.code}<input readOnly value={state.code} onFocus={e=>e.target.select()}/></label>
      <p>{t.privacy}</p><div><button type="button" className="btn light" onClick={copy}>{t.copy}</button>{canShare && <button type="button" className="btn light" onClick={share}>{t.share}</button>}</div>
      {message && <p role="status">{message}</p>}
    </div>}
    <p className="form-note">{t.test}</p>
  </>;
}
