import './MessageRichContent.css';

function formatFav(value) {
  const number = Number(value || 0) / 1000000;
  return Number.isInteger(number) ? number.toLocaleString() : number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function DealMessageCard({ deal, onOpen, compact = false }) {
  if (!deal?.id) return null;
  return <article className={`message-deal-card ${compact ? 'compact' : ''}`}>
    <div className="message-deal-top"><span>{deal.category || 'Deal'}</span><b>★ Deal</b></div>
    <h4>{deal.title || 'Favourit deal'}</h4>
    {!compact && deal.description && <p>{deal.description}</p>}
    <div className="message-deal-meta"><span>{deal.seller_name || 'Favourit seller'}</span><strong>{formatFav(deal.price_fav)} FAV</strong></div>
    <div className="message-deal-bottom"><small>{deal.delivery_days ? `${deal.delivery_days} day${Number(deal.delivery_days) === 1 ? '' : 's'} delivery` : 'Protected deal'}</small>{onOpen && <button type="button" onClick={() => onOpen(deal)}>View deal →</button>}</div>
  </article>;
}

export function MessageMediaGrid({ attachments = [] }) {
  const media = Array.isArray(attachments) ? attachments.filter(item => item?.url) : [];
  if (!media.length) return null;
  return <div className={`message-media-grid count-${Math.min(media.length, 4)}`}>
    {media.map(item => item.media_type === 'video'
      ? <video key={item.asset_id || item.storage_path} controls preload="metadata" src={item.url} aria-label={item.file_name || 'Video'} />
      : <a key={item.asset_id || item.storage_path} href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={item.file_name || 'Shared image'} loading="lazy" /></a>)}
  </div>;
}

export function MessageRichContent({ message, onOpenDeal }) {
  if (!message || message.is_deleted) return null;
  return <>
    <MessageMediaGrid attachments={message.attachments} />
    {message.deal && <DealMessageCard deal={message.deal} onOpen={onOpenDeal} />}
  </>;
}

export function DraftRichContent({ attachments = [], deal, onRemoveAttachment, onRemoveDeal }) {
  if (!attachments.length && !deal) return null;
  return <div className="message-draft-rich">
    {attachments.length > 0 && <div className="message-draft-media">{attachments.map((item, index) => <div className="message-draft-media-item" key={item.asset_id || item.storage_path || index}>
      {item.media_type === 'video' ? <video src={item.url} muted preload="metadata" /> : <img src={item.url} alt={item.file_name || 'Attachment'} />}
      {onRemoveAttachment && <button type="button" onClick={() => onRemoveAttachment(index)} aria-label="Remove media">×</button>}
    </div>)}</div>}
    {deal && <div className="message-draft-deal"><DealMessageCard deal={deal} compact />{onRemoveDeal && <button className="message-draft-remove-deal" type="button" onClick={onRemoveDeal}>×</button>}</div>}
  </div>;
}
