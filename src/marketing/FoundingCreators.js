import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAttribution, PILOT_DISCLOSURE, SERVICE_AREAS, submitApplication, validateApplication } from './programme';
import './FoundingCreators.css';

const initial = { name: '', email: '', area: '', offer: '', need: '', portfolio: '', availability: '', website: '', pilotConsent: false, contactConsent: false, adultConsent: false, digestConsent: false };
const services = [
  { id: 'portfolio-review', area: 'VISUAL DESIGN', title: 'Give your portfolio a fresh pair of eyes.', scope: 'A review of up to five pages, with three prioritised improvements and written notes.', exclude: 'A full redesign or implementation.', delivery: 'A small review package, scoped and priced by the member.', number: '01' },
  { id: 'short-video', area: 'SHORT-FORM VIDEO', title: 'Turn your footage into a sharper story.', scope: 'One edit of up to 30 seconds using footage you supply, with captions and one revision.', exclude: 'Filming, paid assets, or a full campaign.', delivery: 'Agree source files, aspect ratio, and turnaround before ordering.', number: '02' },
  { id: 'copy-review', area: 'WRITING', title: 'Make your next introduction count.', scope: 'A rewrite of a homepage introduction of up to 150 words, with one revision.', exclude: 'A full website rewrite or independent research.', delivery: 'Agree audience, tone, and the exact deliverable before ordering.', number: '03' },
];

export default function FoundingCreators({ client = supabase }) {
  const [programme, setProgramme] = useState({ applications_open: false, founder_name: 'Adam Levi', contact_email: 'adamzoharlevi@gmail.com' });
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const summary = useRef(null);
  useEffect(() => {
    document.title = 'Favourit Founding Creators — Your skills are your currency';
    let active = true;
    if (client) client.rpc('get_founding_programme').then(({ data, error }) => {
      if (active && !error && data) setProgramme(data);
    }).catch(() => {});
    return () => { active = false; };
  }, [client]);
  const change = event => {
    const { name, type, checked, value } = event.target;
    setValues(previous => ({ ...previous, [name]: type === 'checkbox' ? checked : value }));
  };
  async function apply(event) {
    event.preventDefault();
    if (status === 'sending' || !programme.applications_open) return;
    const next = validateApplication(values);
    setErrors(next); setMessage('');
    if (Object.keys(next).length) { setTimeout(() => summary.current?.focus(), 0); return; }
    setStatus('sending');
    try {
      await submitApplication(client, values, getAttribution(window.location.search));
      setStatus('received'); setValues(initial);
    } catch (error) { setStatus('idle'); setMessage(error.message); }
  }
  const field = (name, label, options = {}) => <div className={`fc-field ${options.wide ? 'fc-wide' : ''}`}>
    <label htmlFor={`fc-${name}`}>{label}</label>
    {options.multiline ? <textarea id={`fc-${name}`} name={name} value={values[name]} onChange={change} rows="3" maxLength={options.max || 1200} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `fc-${name}-error` : undefined} /> : <input id={`fc-${name}`} name={name} type={options.type || 'text'} value={values[name]} onChange={change} maxLength={options.max || 100} autoComplete={options.autoComplete} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `fc-${name}-error` : undefined} />}
    {options.help && <small>{options.help}</small>}
    {errors[name] && <span className="fc-error" id={`fc-${name}-error`}>{errors[name]}</span>}
  </div>;
  return <div className="fc-page">
    <a className="fc-skip" href="#fc-main">Skip to content</a>
    <header className="fc-header"><a className="fc-brand" href="/founding-creators" aria-label="Favourit home">favourit<span>.</span></a><nav aria-label="Main navigation"><a href="#services">The services</a><a href="#how-it-works">How it works</a><a href="#questions">Questions</a></nav><a className="fc-button fc-small" href="#apply">Join the founding creators <span aria-hidden="true">↗</span></a></header>
    <main id="fc-main">
      <section className="fc-hero">
        <div className="fc-hero-copy"><p className="fc-eyebrow"><span aria-hidden="true" className="fc-dot" /> FOR INDEPENDENT CREATIVES</p><h1>Your skills are<br />your <em>currency.</em></h1><p className="fc-lead">Offer creative services, earn FAV, and use it to get design, video, and writing help from other creators.</p><div className="fc-actions"><a className="fc-button" href="#apply">Apply to join the founding creators <span aria-hidden="true">↗</span></a><a className="fc-text-link" href="#how-it-works">See how an exchange works <span aria-hidden="true">↓</span></a></div><p className="fc-disclosure">{PILOT_DISCLOSURE}</p></div>
        <figure className="fc-hero-image"><img src="/marketing/creator-workbench.png" width="1536" height="1024" alt="Concept artwork of design sheets, a video storyboard, and typography samples on a creative studio desk." fetchpriority="high" /><figcaption>Different skills. A shared place to create.<small>Concept artwork · not member portfolio work</small></figcaption></figure>
      </section>
      <div className="fc-fields-strip" aria-label="Pilot service areas"><span>VISUAL DESIGN</span><span aria-hidden="true">✳</span><span>SHORT-FORM VIDEO</span><span aria-hidden="true">✳</span><span>WRITING</span></div>
      <section className="fc-section" id="services"><div className="fc-section-heading"><div><p className="fc-eyebrow">START WITH SOMETHING SPECIFIC</p><h2>A little help can move<br />your next project forward.</h2></div><p>Bring one thing you do well, and one thing you need help with. These examples show the kind of small, clearly scoped services we are starting with.</p></div><p className="fc-example-note">Illustrative service examples. These are not live listings or available bookings.</p><div className="fc-services">{services.map(service => <article className="fc-service" id={`service-${service.id}`} key={service.id}><div className="fc-service-top"><span>{service.area}</span><b aria-hidden="true">{service.number}</b></div><h3>{service.title}</h3><p>{service.scope}</p><details><summary>See the scope</summary><p><strong>Not included:</strong> {service.exclude}</p><p>{service.delivery}</p><p>The member sets the price in FAV. Buyer and seller fees are shown before an order.</p></details><a className="fc-text-link" href={`#service-${service.id}`} aria-label={`Direct link to ${service.area.toLowerCase()} example`}>Link to this example ↗</a></article>)}</div></section>
      <section className="fc-section fc-exchange" id="how-it-works"><div><p className="fc-eyebrow">OFFER. EARN. SPEND.</p><h2>You don’t have to<br />do it all yourself.</h2><p>A designer can offer a portfolio review, earn FAV when the order is completed, then put that FAV towards a video edit from another member.</p><p className="fc-muted">An illustrative journey, not a promised match. The services do not need to come from the same person.</p></div><ol className="fc-steps"><li><span>01</span><div><h3>Offer what you do well</h3><p>Define a deliverable, price, turnaround, and revisions.</p></div></li><li><span>02</span><div><h3>Complete the work. Earn FAV.</h3><p>Follow the order process and receive the seller proceeds on completion.</p></div></li><li><span>03</span><div><h3>Get the help you need</h3><p>Use your available FAV on another member’s service, including the buyer fee.</p></div></li></ol></section>
      <section className="fc-section fc-programme" id="programme"><div><p className="fc-eyebrow">THE FOUNDING CREATORS</p><h2>A small beginning.<br /><em>Built with you.</em></h2><p>We’re preparing a first group of up to 30 creatives. A small group means we can learn what you need and help you find your feet.</p><a className="fc-button" href="#apply">Tell us what you offer and need ↗</a></div><ul className="fc-benefits"><li><h3>A clear first service</h3><p>Help shaping your skill into a practical, bounded package.</p></li><li><h3>A personal introduction</h3><p>Onboarding and introductions based on complementary needs.</p></li><li><h3>A say in what comes next</h3><p>Direct feedback, support, and optional member spotlights.</p></li><li><h3>Relevant opportunities</h3><p>An optional weekly digest of actual member requests.</p></li></ul></section>
      <section className="fc-section fc-fav" id="fav"><div><p className="fc-eyebrow">UNDERSTANDING FAV</p><h2>Useful inside<br />the community.</h2><p>FAV is the unit used to price and exchange services on Favourit. During this pilot it can be earned and spent inside the marketplace.</p><p><strong>FAV has no guaranteed cash value. Cash-out is unavailable during this pilot.</strong> Joining does not guarantee orders, earnings, or a match.</p></div><div className="fc-fee-example"><p className="fc-eyebrow">ILLUSTRATIVE FEE EXAMPLE</p><dl><div><dt>Service price</dt><dd>100 FAV</dd></div><div><dt>Buyer fee · 3%</dt><dd>3 FAV</dd></div><div className="fc-total"><dt>Buyer pays</dt><dd>103 FAV</dd></div><div><dt>Seller fee · 3% of service price</dt><dd>3 FAV</dd></div><div className="fc-total"><dt>Seller receives</dt><dd>97 FAV</dd></div></dl><p>Illustrates the current fee model. This is not a cash exchange rate. Actual order amounts are confirmed at checkout.</p></div></section>
      <section className="fc-section fc-trust"><p className="fc-eyebrow">A HUMAN START</p><h2>Clear expectations.<br />People you can talk to.</h2><p>Favourit is in development. We are speaking with creators before opening the first service exchanges. The order, dispute, and support processes must be ready before members contribute real work.</p>{programme.founder_name && <p>Founded by <strong>{programme.founder_name}</strong>.</p>}{programme.contact_email && <a className="fc-text-link" href={`mailto:${programme.contact_email}`}>Contact the founding team ↗</a>}<p className="fc-muted">We’ll ask separately before publishing your work, feedback, or story.</p></section>
      <section className="fc-section fc-faq" id="questions"><div><p className="fc-eyebrow">GOOD QUESTIONS</p><h2>Before you join.</h2></div><div>{[
        ['Who is this for?', 'Adults aged 18 and over who offer visual design, short-form video, or writing, and have a specific service they need for a project within the next 30 days.'],
        ['Can I withdraw FAV as money?', 'No. Cash-out is unavailable during this pilot. Do not participate expecting cash income, token appreciation, or a later redemption guarantee.'],
        ['Do I have to exchange with the same person?', 'No. FAV lets you provide a service to one member and buy a service from another, when a suitable service is available and your balance covers the price and buyer fee.'],
        ['Will I get a client or a match?', 'We help with introductions, but there are no guaranteed orders, earnings, or matches. We are testing whether a small group can create useful exchanges.'],
        ['What happens after I apply?', 'We review your offer and need and may invite you to a research conversation. An application is not admission. Service exchanges open only after the research and product-readiness checks.'],
        ['Can I suggest a service that is missing?', 'Yes. Describe it in the “service I need” field. We use requests to decide which complementary skills to invite next.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
      <section className="fc-section fc-apply" id="apply"><div><p className="fc-eyebrow">LET’S START WITH YOUR PROJECT</p><h2>What do you do well?<br /><em>What do you need?</em></h2><p>Tell us a little about both. We’re looking for a small group with useful skills and complementary needs.</p><p className="fc-disclosure">{PILOT_DISCLOSURE}</p><p className="fc-muted">Application details are private. Digest emails are optional. We do not publish your application or portfolio without separate permission.</p></div><div className="fc-form-panel">{status === 'received' ? <div role="status"><p className="fc-eyebrow">APPLICATION RECEIVED</p><h3>Thank you for sharing your next step.</h3><p>We may contact you about a research conversation. This is not confirmation of a place or an order.</p></div> : <form onSubmit={apply} noValidate>
        {!programme.applications_open && <p className="fc-form-notice" role="status">Applications are not open yet. This form shows what we will ask. Nothing is sent or saved while applications are closed.</p>}
        {Object.keys(errors).length > 0 && <div ref={summary} tabIndex="-1" role="alert" className="fc-error-summary">Please check the highlighted fields.</div>}
        <div className="fc-form-grid">{field('name', 'Your name', { autoComplete: 'name' })}{field('email', 'Email', { type: 'email', max: 254, autoComplete: 'email' })}<div className="fc-field fc-wide"><label htmlFor="fc-area">Your main service area</label><select id="fc-area" name="area" value={values.area} onChange={change} aria-invalid={Boolean(errors.area)} aria-describedby={errors.area ? 'fc-area-error' : undefined}><option value="">Choose a service area</option>{SERVICE_AREAS.map(area => <option key={area}>{area}</option>)}</select>{errors.area && <span className="fc-error" id="fc-area-error">{errors.area}</span>}</div>{field('offer', 'One service I can offer', { multiline: true, wide: true, help: 'Describe the deliverable and what is included.' })}{field('need', 'One service I need in the next 30 days', { multiline: true, wide: true, help: 'What are you working on, and what would help?' })}{field('portfolio', 'Link to your work', { type: 'url', max: 1000, wide: true, help: 'A public HTTPS portfolio or work sample.' })}{field('availability', 'When could you participate?', { max: 200, wide: true, help: 'For example, two hours next week. Include your time zone if useful.' })}</div>
        <div className="fc-honeypot" aria-hidden="true"><label htmlFor="fc-website">Leave this field empty</label><input id="fc-website" name="website" value={values.website} onChange={change} autoComplete="off" tabIndex="-1" /></div>
        <div className="fc-consents">{[
          ['pilotConsent', 'I understand that FAV is usable inside Favourit, cash-out is unavailable in this pilot, and orders or earnings are not guaranteed.'],
          ['contactConsent', 'Favourit may use these details to review my application, understand service needs, and contact me about the pilot.'],
          ['adultConsent', 'I am at least 18 years old.'],
          ['digestConsent', 'Optional: email me the weekly opportunity digest when it starts. I can unsubscribe at any time.'],
        ].map(([name, label]) => <div key={name}><label><input type="checkbox" name={name} checked={values[name]} onChange={change} aria-invalid={Boolean(errors[name])} />{label}</label>{errors[name] && <p className="fc-error">{errors[name]}</p>}</div>)}</div><p className="fc-muted">Read <a href="#application-privacy">how we handle application details</a>.</p>{message && <p className="fc-error" role="alert">{message}</p>}<button className="fc-button" type="submit" disabled={!programme.applications_open || status === 'sending'}>{status === 'sending' ? 'Sending application…' : programme.applications_open ? 'Send my application ↗' : 'Applications opening after research'}</button>
      </form>}</div></section>
      <section className="fc-section fc-privacy" id="application-privacy"><h2>Application privacy</h2><p>When applications open, Favourit will collect the details you submit, your consent choices, and campaign or referral codes in the page link. These help us review applications, understand demand, and contact you about the programme. Applications are restricted to the authorised programme administrator. No full browsing history, wallet details, or payment information is requested here.</p><p>Research applications are reviewed for deletion after 90 days unless you join the programme or ask us to retain them. Joining requires a separate onboarding notice. Marketing emails require the optional digest choice. We will ask separately before using your name, portfolio, or feedback publicly.</p>{programme.contact_email ? <p>To request access, correction, deletion, or withdrawal of contact consent, email <a href={`mailto:${programme.contact_email}`}>{programme.contact_email}</a>.</p> : <p>The contact address will be published before application collection opens.</p>}</section>
    </main><footer className="fc-footer"><a href="/founding-creators" className="fc-brand">favourit<span>.</span></a><p>Made for people who make things.</p><a href="#application-privacy">Application privacy</a><a href="#fav">How FAV works</a><span>Founding creators · private pilot</span></footer>
  </div>;
}

