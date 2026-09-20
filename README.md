# YesWeHack MCP

Serveur [Model Context Protocol](https://modelcontextprotocol.io/) non officiel et
**entièrement en lecture seule** pour un compte hunter YesWeHack.

Il s'authentifie directement avec l'adresse e-mail, le mot de passe et le secret
TOTP du compte. Aucun navigateur et aucun Personal Access Token ne sont requis.
Le jeton de session obtenu reste uniquement en mémoire.

> Ce projet n'est ni développé, ni sponsorisé, ni approuvé par YesWeHack.

## Fonctionnalités

- Consultation des programmes publics et privés accessibles au hunter
- Lecture des règles, scopes, exclusions et grilles de récompenses
- Vérification locale d'une URL, d'un domaine ou d'une IPv4 contre les scopes
- Consultation et recherche des rapports du hunter
- Chronologie, statistiques et tableau de bord du compte
- Consultation du solde et de l'historique des crédits
- Hacktivity et classement lorsqu'ils sont publiés par le programme
- Métadonnées des credentials de test avec secrets systématiquement masqués

## Prérequis

- Node.js 20 ou supérieur
- npm
- Un compte hunter YesWeHack avec TOTP activé
- Un client MCP, par exemple Codex CLI

## Installation rapide

```bash
git clone https://github.com/Miro-sh/yeswehack-mcp.git
cd yeswehack-mcp
npm ci
cp .env.example .env
chmod 600 .env
```

Compléter ensuite `.env` :

```dotenv
YESWEHACK_EMAIL=adresse@example.com
YESWEHACK_PASSWORD="mot_de_passe"
YESWEHACK_TOPT_KEY=SECRET_BASE32
```

Puis compiler et enregistrer le serveur dans Codex CLI :

```bash
npm run build
codex mcp add yeswehack -- node "$PWD/dist/src/index.js"
```

Redémarrer Codex CLI, puis appeler `session_status` pour vérifier la connexion.

### Variables d'environnement

| Variable | Description |
| --- | --- |
| `YESWEHACK_EMAIL` | Adresse e-mail du compte hunter |
| `YESWEHACK_PASSWORD` | Mot de passe du compte |
| `YESWEHACK_TOPT_KEY` | Secret TOTP Base32 ou URI `otpauth://` complète |
| `YESWEHACK_TOTP_KEY` | Alias accepté pour `YESWEHACK_TOPT_KEY` |
| `YESWEHACK_ENV_FILE` | Chemin optionnel vers un autre fichier d'environnement |

Si le mot de passe contient `#` ou des espaces, il faut l'entourer de guillemets
doubles. Le nom `YESWEHACK_TOPT_KEY` conserve volontairement l'orthographe
historique utilisée par le projet.

## Outils MCP

| Outil | Description |
| --- | --- |
| `session_status` | Vérifie la configuration et l'authentification |
| `list_accessible_programs` | Liste les programmes explicitement accessibles |
| `search_programs` | Recherche le catalogue visible |
| `get_program` | Lit le détail, les règles et les scopes d'un programme |
| `check_scope` | Compare une cible aux scopes déclarés |
| `recently_updated_programs` | Repère les programmes récemment modifiés |
| `compare_programs` | Compare deux à cinq programmes |
| `get_program_hacktivity` | Lit la hacktivity publiée par un programme |
| `get_program_ranking` | Lit le classement publié par un programme |
| `list_program_credentials` | Liste les métadonnées des credentials, secrets masqués |
| `get_my_credit_balance` | Retourne le nombre de crédits disponibles |
| `get_my_credit_history` | Liste les gains et dépenses de crédits |
| `list_my_reports` | Liste les rapports du hunter |
| `search_my_reports` | Recherche les rapports avec filtres |
| `get_my_report` | Lit le détail d'un rapport |
| `get_report_activity` | Lit la chronologie d'un rapport |
| `my_report_status_counts` | Compte les rapports par statut |
| `my_hunter_dashboard` | Retourne les statistiques agrégées du hunter |

La hacktivity, le classement et les credentials dépendent des options et droits
de chaque programme. L'outil renvoie une réponse explicite lorsqu'une fonction
n'est pas publiée ou accessible.

## Sécurité

- Tous les outils sont annotés en lecture seule.
- Aucune création ou modification de rapport, commentaire, statut ou profil
  n'est exposée.
- Le jeton d'accès n'est jamais écrit sur disque ni renvoyé par un outil.
- Les logins, e-mails, alias et mots de passe des credentials sont remplacés par
  de simples indicateurs de présence.
- Les jetons de tracker et les URL de pièces jointes sont exclus des résultats.
- `.env` et ses variantes sont ignorés par Git ; seul `.env.example` est suivi.

`check_scope` est une aide technique conservatrice. Il ne remplace jamais la
lecture des règles, exclusions et conditions particulières du programme avant
un test de sécurité.

## Architecture

```text
src/index.ts            point d'entrée stdio MCP
src/tools.ts            outils principaux
src/advanced-tools.ts   outils avancés et projections sécurisées
src/auth.ts             connexion email/password/TOTP et cache mémoire
src/api.ts              client HTTP YesWeHack authentifié
src/scope.ts            moteur local de correspondance des scopes
test/                   tests unitaires
```

Lors du premier appel authentifié, le serveur effectue `/login`, génère le code
TOTP localement, puis finalise la connexion avec `/account/totp`. Le jeton est
mis en cache en mémoire et renouvelé automatiquement si l'API répond `401`.

## Développement

```bash
npm ci
npm run check
npm test
npm run build
```

Tests avec un compte configuré :

```bash
npm run smoke
npm run smoke:mcp
```

Les tests automatisés ne nécessitent pas de véritables identifiants et
n'affichent jamais le contenu de `.env`. Le workflow GitHub Actions exécute le
type-checking, les tests et la compilation sur chaque push et pull request.

## Contribution et sécurité

Les contributions sont détaillées dans [CONTRIBUTING.md](CONTRIBUTING.md). Pour
signaler une vulnérabilité, suivre [SECURITY.md](SECURITY.md) et ne jamais ouvrir
une issue contenant des identifiants, un secret TOTP ou un jeton.

## Licence

Distribué sous licence MIT. Voir [LICENSE](LICENSE).
