'use client';
import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';

export default function PublicHelper(){
 const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[language,setLanguage]=useState('en');
 const opener=useRef(null),input=useRef(null),panel=useRef(null),request=useRef(false);
 useEffect(()=>{if(open)input.current?.focus()},[open]);
 function close(){setOpen(false);opener.current?.focus()}
 async function submit(e){e.preventDefault();const text=message.trim();if(!text||request.current)return;request.current=true;setBusy(true);setAnswer('');
  try{const response=await fetch('/api/public/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,language})});const body=await response.json();setAnswer(response.ok&&typeof body.answer==='string'?body.answer:(language==='es'?'No disponible. Inténtalo de nuevo.':'Unavailable. Please try again.'))}
  catch{setAnswer(language==='es'?'No disponible. Inténtalo de nuevo.':'Unavailable. Please try again.')}
  finally{request.current=false;setBusy(false);if(document.activeElement===document.body||panel.current?.contains(document.activeElement))input.current?.focus()}
 }
 const es=language==='es';
 return <div className="public-helper" lang={language}>
  {open&&<section ref={panel} className="helper-panel" aria-label={es?'Ayuda pública':'Public helper'} onKeyDown={e=>{if(e.key==='Escape')close()}}><header><strong>{es?'¿Cómo podemos ayudar?':'How can we help?'}</strong><button type="button" onClick={close} aria-label={es?'Cerrar ayuda':'Close helper'}><X size={18}/></button></header>
   <p>{es?'Ayuda con reglas y cálculos, no IA. No escribas datos personales.':'Rules-based help and calculations, not AI. Please don’t enter personal information.'}</p>
   <button type="button" className="helper-language" onClick={()=>{setLanguage(es?'en':'es');setAnswer('')}}>{es?'English':'Español'}</button>
   {answer&&<div className="helper-answer" role="status">{answer}</div>}
   <form onSubmit={submit}><label htmlFor="public-helper-input">{es?'Pregunta o cálculo':'Question or calculation'}</label><div><input ref={input} id="public-helper-input" maxLength={500} value={message} onChange={e=>setMessage(e.target.value)} placeholder={es?'Por ejemplo: 12 * 5':'For example: 12 * 5'}/><button type="submit" disabled={busy||!message.trim()} aria-label={es?'Enviar':'Send'}><Send size={17}/></button></div></form>
  </section>}
  <button ref={opener} type="button" className="helper-toggle" aria-expanded={open} onClick={()=>open?close():setOpen(true)}><MessageCircle size={19}/>{es?'Ayuda':'Help'}</button>
 </div>
}
