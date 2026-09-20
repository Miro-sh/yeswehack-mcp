# Politique de sécurité

## Signaler une vulnérabilité

Ne publiez pas de vulnérabilité, d'identifiant ou de secret dans une issue.
Utilisez la fonction **Security > Report a vulnerability** du dépôt GitHub pour
envoyer un rapport privé avec les étapes de reproduction et l'impact estimé.

## En cas de fuite locale

Si un mot de passe, un secret TOTP ou un jeton a été exposé :

1. changez immédiatement le mot de passe YesWeHack ;
2. réinitialisez le TOTP du compte ;
3. révoquez les sessions actives si cette option est disponible ;
4. retirez le secret de l'historique concerné avant tout nouveau partage.

Le fichier `.env` est ignoré par Git, mais il reste de la responsabilité de
l'utilisateur de protéger sa copie locale et de conserver ses permissions à
`600`.
