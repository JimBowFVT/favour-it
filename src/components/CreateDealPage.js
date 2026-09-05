import { useMemo, useState } from 'react';
import { serviceCategories, serviceFamilies } from '../data/serviceCategories';
import './CreateDealPage.css';

const SERVICE_TYPES = [
  { id: 'deliverable', label: 'Digital deliverable', copy: 'A file, design, build, edit, document or other defined result.' },
  { id: 'session', label: 'Live session', copy: 'Coaching, tutoring, consulting or another remote session.' },
  { id: 'managed', label: 'Managed service', copy: 'Ongoing work delivered over an agreed period.' },
  { id: 'audit', label: 'Audit & consultation', copy: 'Review, analysis, recommendations and expert guidance.' },
];

const INITIAL_PACKAGES = [
  { tier: 'basic', enabled: true, title: 'Basic', description: '', price: '', deliveryDays: 3, revisions: 1, sessionMinutes: 60 },
  { tier: 'standard', enabled: true, title: 'Standard', description: '', price: '', deliveryDays: 5, revisions: 2, sessionMinutes: 90 },
  { tier: 'premium', enabled: false, title: 'Premium', description: '', price: '', deliveryDays: 7, revisions: 3, sessionMinutes: 120 },
];

function PackageEditor({ item, serviceType, onChange, onToggle }) {
  const isBasic = item.tier === 'basic';
  return <article className={`create-package ${item.enabled ? 'enabled' : 'disabled'}`}>
    <div className="create-package-head">
      <div><span>{item.tier.toUpperCase()}</span><strong>{item.title}</strong></div>
      {!isBasic && <label className="create-package-toggle"><input type="checkbox" checked={item.enabled} onChange={event => onToggle(item.tier, event.target.checked)} /><span>{item.enabled ? 'Included' : 'Off'}</span></label>}
    </div>
    {item.enabled && <div className="create-package-fields">
      <label>Package name<input value={item.title} maxLength="60" onChange={event => onChange(item.tier, 'title', event.target.value)} placeholder="Basic" /></label>
      <label className="wide">What is included?<textarea value={item.description} maxLength="500" rows="3" onChange={event => onChange(item.tier, 'description', event.target.value)} placeholder="Describe exactly what this package includes…" /></label>
      <label>Price in FAV<input value={item.price} type="number" min="0.01" step="0.01" onChange={event => onChange(item.tier, 'price', event.target.value)} placeholder="150" /></label>
      <label>{serviceType === 'session' ? 'Schedule within' : 'Delivery'}<select value={item.deliveryDays} onChange={event => onChange(item.tier, 'deliveryDays', Number(event.target.value))}>{[1,2,3,5,7,14,21,30].map(day => <option key={day} value={day}>{day} day{day === 1 ? '' : 's'}</option>)}</select></label>
      <label>Revisions<input value={item.revisions} type="number" min="0" max="99" onChange={event => onChange(item.tier, 'revisions', Number(event.target.value))} /></label>
      {serviceType === 'session' && <label>Session length<select value={item.sessionMinutes} onChange={event => onChange(item.tier, 'sessionMinutes', Number(event.target.value))}>{[30,45,60,90,120,180,240].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>}
    </div>}
  </article>;
}

export default function CreateDealPage({ onBack, onCreated, busy }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [serviceType, setServiceType] = useState('deliverable');
  const [description, setDescription] = useState('');
  const [buyerRequirements, setBuyerRequirements] = useState('');
  const [packages, setPackages] = useState(INITIAL_PACKAGES);
  const [faqs, setFaqs] = useState([{ question: '', answer: '' }]);
  const [portfolio, setPortfolio] = useState([{ title: '', url: '' }]);

  const selectedCategory = serviceCategories.find(item => item.label === category);
  const selectedFamily = serviceFamilies.find(item => item.id === selectedCategory?.family);
  const activePackages = useMemo(() => packages.filter(item => item.enabled), [packages]);

  const patchPackage = (tier, key, value) => setPackages(current => current.map(item => item.tier === tier ? { ...item, [key]: value } : item));
  const togglePackage = (tier, enabled) => setPackages(current => current.map(item => item.tier === tier ? { ...item, enabled } : item));
  const patchFaq = (index, key, value) => setFaqs(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const patchPortfolio = (index, key, value) => setPortfolio(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));

  const packagesValid = activePackages.length > 0 && activePackages.every(item => item.title.trim().length >= 2 && Number(item.price) > 0 && Number(item.deliveryDays) >= 1 && Number(item.revisions) >= 0);
  const canPublish = title.trim().length >= 10 && description.trim().length >= 20 && category && packagesValid && !busy;

  const submit = () => {
    if (!canPublish) return;
    onCreated({
      title: title.trim(),
      category,
      serviceType,
      description: description.trim(),
      buyerRequirements: buyerRequirements.trim(),
      packages: activePackages.map(item => ({
        tier: item.tier,
        title: item.title.trim(),
        description: item.description.trim(),
        price: Number(item.price),
        deliveryDays: Number(item.deliveryDays),
        revisions: Number(item.revisions),
        ...(serviceType === 'session' ? { sessionMinutes: Number(item.sessionMinutes) } : {}),
      })),
      faqs,
      portfolio,
    });
  };

  return <section className="page-section create-deal-page">
    <button className="back-button" type="button" onClick={onBack}>← Back to Explore</button>
    <div className="create-deal-hero">
      <div><div className="eyebrow">CREATE A DEAL</div><h1>Package your work so buyers know <span>exactly what they get.</span></h1><p>Choose an approved remote service, define the scope and sell one to three clear packages protected by Favourit.</p></div>
      <div className="create-deal-progress"><span className="done">1</span><b>Service</b><i></i><span className="done">2</span><b>Packages</b><i></i><span>3</span><b>Publish</b></div>
    </div>

    <div className="create-deal-layout">
      <div className="create-deal-main">
        <section className="create-deal-card">
          <div className="create-card-heading"><span>01</span><div><h2>What are you offering?</h2><p>Describe one service clearly enough that a buyer can understand it without guessing.</p></div></div>
          <label>Deal title<input value={title} maxLength="120" onChange={event => setTitle(event.target.value)} placeholder="I will design a complete brand identity for your business" /><small>{title.length}/120</small></label>
          <label>Service category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose a category</option>{serviceFamilies.map(family => <optgroup key={family.id} label={family.label}>{serviceCategories.filter(item => item.family === family.id).map(item => <option key={item.id} value={item.label}>{item.label}</option>)}</optgroup>)}</select>{selectedFamily && <small>{selectedFamily.label}</small>}</label>
          <label>Full description<textarea value={description} maxLength="5000" rows="7" onChange={event => setDescription(event.target.value)} placeholder="Explain the work, what is included, what is not included and what a successful delivery looks like…" /><small>{description.length}/5000</small></label>
        </section>

        <section className="create-deal-card">
          <div className="create-card-heading"><span>02</span><div><h2>How is the service delivered?</h2><p>This changes how buyers understand timing and scope.</p></div></div>
          <div className="create-service-types">{SERVICE_TYPES.map(item => <button key={item.id} type="button" className={serviceType === item.id ? 'active' : ''} onClick={() => setServiceType(item.id)}><strong>{item.label}</strong><small>{item.copy}</small></button>)}</div>
        </section>

        <section className="create-deal-card">
          <div className="create-card-heading"><span>03</span><div><h2>Build your packages</h2><p>Basic is required. Standard and Premium are optional.</p></div></div>
          <div className="create-packages">{packages.map(item => <PackageEditor key={item.tier} item={item} serviceType={serviceType} onChange={patchPackage} onToggle={togglePackage} />)}</div>
        </section>

        <section className="create-deal-card">
          <div className="create-card-heading"><span>04</span><div><h2>What do you need from the buyer?</h2><p>Collect the information you need before work starts.</p></div></div>
          <label>Buyer requirements<textarea value={buyerRequirements} maxLength="3000" rows="5" onChange={event => setBuyerRequirements(event.target.value)} placeholder="For example: brand name, reference files, goals, access details or questions to answer before we begin…" /><small>{buyerRequirements.length}/3000</small></label>
        </section>

        <section className="create-deal-card">
          <div className="create-card-heading"><span>05</span><div><h2>FAQ</h2><p>Answer the questions buyers are most likely to ask before ordering.</p></div></div>
          <div className="create-repeat-list">{faqs.map((item, index) => <div className="create-repeat-row" key={index}><input value={item.question} maxLength="180" onChange={event => patchFaq(index, 'question', event.target.value)} placeholder="Question" /><textarea value={item.answer} maxLength="800" rows="2" onChange={event => patchFaq(index, 'answer', event.target.value)} placeholder="Answer" />{faqs.length > 1 && <button type="button" onClick={() => setFaqs(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}</div>
          {faqs.length < 8 && <button type="button" className="secondary create-add-row" onClick={() => setFaqs(current => [...current, { question: '', answer: '' }])}>+ Add FAQ</button>}
        </section>

        <section className="create-deal-card">
          <div className="create-card-heading"><span>06</span><div><h2>Portfolio samples</h2><p>Add optional links to relevant work. Portfolio uploads can be added later without changing the deal model.</p></div></div>
          <div className="create-repeat-list">{portfolio.map((item, index) => <div className="create-portfolio-row" key={index}><input value={item.title} maxLength="100" onChange={event => patchPortfolio(index, 'title', event.target.value)} placeholder="Sample title" /><input value={item.url} maxLength="1000" onChange={event => patchPortfolio(index, 'url', event.target.value)} placeholder="https://…" />{portfolio.length > 1 && <button type="button" onClick={() => setPortfolio(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</div>)}</div>
          {portfolio.length < 6 && <button type="button" className="secondary create-add-row" onClick={() => setPortfolio(current => [...current, { title: '', url: '' }])}>+ Add work sample</button>}
        </section>
      </div>

      <aside className="create-deal-summary">
        <div className="eyebrow">DEAL PREVIEW</div>
        <span className="create-summary-category">{category || 'Choose a category'}</span>
        <h2>{title.trim() || 'Your deal title will appear here'}</h2>
        <p>{description.trim() || 'Add a clear description so buyers know what they are purchasing.'}</p>
        <div className="create-summary-type"><small>Service type</small><strong>{SERVICE_TYPES.find(item => item.id === serviceType)?.label}</strong></div>
        <div className="create-summary-packages">{activePackages.map(item => <div key={item.tier}><span>{item.title || item.tier}</span><strong>{item.price ? `${item.price} FAV` : 'Set price'}</strong><small>{item.deliveryDays} day{item.deliveryDays === 1 ? '' : 's'} · {item.revisions} revisions</small></div>)}</div>
        <div className="create-summary-policy"><strong>Favourit marketplace</strong><span>Only approved remote professional services can be published. Clear scope makes escrow and disputes fairer for both sides.</span></div>
        <button className="primary full" type="button" disabled={!canPublish} onClick={submit}>{busy ? 'Publishing…' : 'Publish deal →'}</button>
        {!packagesValid && <small className="create-summary-error">Every active package needs a name, price, delivery time and valid revision count.</small>}
      </aside>
    </div>
  </section>;
}
