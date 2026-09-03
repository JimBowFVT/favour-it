export default function FavouritLoader({ title = 'Preparing your Favourit account', subtitle = 'Securing your session and loading your wallet…' }) {
  return (
    <main className="favourit-loader" role="status" aria-live="polite" aria-label={title}>
      <div className="loader-glow loader-glow-one" />
      <div className="loader-glow loader-glow-two" />
      <div className="loader-card">
        <div className="loader-mark" aria-hidden="true">
          <span className="loader-ring loader-ring-one" />
          <span className="loader-ring loader-ring-two" />
          <span className="loader-core">F</span>
        </div>
        <div className="loader-brand"><span>Favour</span><i>it</i></div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <div className="loader-progress" aria-hidden="true"><span /></div>
        <div className="loader-dots" aria-hidden="true"><b /><b /><b /></div>
      </div>
    </main>
  );
}
