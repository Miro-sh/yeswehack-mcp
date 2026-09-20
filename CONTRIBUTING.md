# Contribuer

Merci de contribuer à YesWeHack MCP.

## Développement local

1. Forker puis cloner le dépôt.
2. Installer les dépendances avec `npm ci`.
3. Créer une branche dédiée à la modification.
4. Implémenter le changement sans ajouter d'opération d'écriture côté YesWeHack.
5. Exécuter `npm run ci` avant de proposer une pull request.

## Règles du projet

- Les outils MCP doivent rester en lecture seule.
- Toute nouvelle réponse API doit passer par une projection explicite afin de
  ne pas exposer de jeton, identifiant ou URL privée par accident.
- Ne jamais committer `.env`, un secret TOTP, un mot de passe, un jeton d'accès
  ou des données privées issues d'un rapport.
- Ajouter ou adapter les tests pour chaque comportement modifié.
- Documenter les nouveaux outils et leurs limites dans le README.

## Pull requests

Une pull request doit expliquer son objectif, les changements fonctionnels, les
risques éventuels et les commandes de validation exécutées. Les modifications
qui ajoutent une mutation de données sur YesWeHack ne seront pas acceptées dans
ce serveur.
