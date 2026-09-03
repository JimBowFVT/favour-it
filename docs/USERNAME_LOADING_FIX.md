# Username onboarding and loading fix

The username suggestion generator is synchronous because suggestions are generated locally. The app loading state is visually branded so the data hydration phase does not fall back to a plain loading sentence.
