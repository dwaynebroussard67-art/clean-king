'use client';

import { useState } from 'react';

// Shared by the meeting demo and the offline quote page. No storage or network access.
export default function QuotePlanner({ lang }) {
  const es = lang === 'es';
  const [plan, setPlan] = useState(null);
  const spaces = es ? ['Oficina', 'Escuela', 'Consultorio', 'Otro espacio'] : ['Office', 'School', 'Medical office', 'Other space'];
  const frequencies = es ? ['Cada noche', 'Semanalmente', 'Por definir'] : ['Nightly', 'Weekly', 'To be determined'];
  const areas = es ? ['Áreas compartidas', 'Baños', 'Pisos', 'Basura'] : ['Shared areas', 'Restrooms', 'Floors', 'Waste'];

  function create(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPlan({ space: data.get('space'), frequency: data.get('frequency'), focus: data.getAll('focus') });
  }

  return <section className="quote-planner">
    <div>
      <div className="mini-label">{es ? 'PLANIFICACIÓN' : 'QUOTE PLANNING'}</div>
      <h2>{es ? 'Arma un plan de ejemplo.' : 'Build an example plan.'}</h2>
      <p>{es ? 'Explora el alcance antes de confirmar servicios y precios. No se envía ni se guarda ninguna solicitud.' : 'Explore a possible scope before services and pricing are confirmed. No request is sent or saved.'}</p>
    </div>
    <form className="planner-form" onSubmit={create}>
      <label>{es ? 'Tipo de espacio' : 'Type of space'}<select name="space">{spaces.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>{es ? 'Frecuencia' : 'Frequency'}<select name="frequency">{frequencies.map(x => <option key={x}>{x}</option>)}</select></label>
      <fieldset><legend>{es ? 'Posibles áreas' : 'Possible areas of focus'}</legend>
        {areas.map((x, i) => <label key={x}><input type="checkbox" name="focus" value={x} defaultChecked={i < 2} />{x}</label>)}
      </fieldset>
      <button className="btn dark" type="submit">{es ? 'Crear plan de ejemplo' : 'Build example plan'}</button>
    </form>
    {plan && <div className="planner-result" role="status">
      <strong>{es ? 'Plan de ejemplo' : 'Example plan'}</strong>
      <p>{plan.space} · {plan.frequency}</p>
      <p>{plan.focus.length ? plan.focus.join(' · ') : (es ? 'Sin áreas seleccionadas' : 'No areas selected')}</p>
      <small>{es ? 'No es una cotización, precio ni contrato.' : 'Not a quote, price or contract.'}</small>
    </div>}
  </section>;
}
