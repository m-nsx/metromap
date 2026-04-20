# Admin Metro (application locale)

Cette application permet de concevoir le reseau metro localement, puis d'exporter un JSON a deployer sur le site public.

## Lancer en local

1. Ouvre le dossier `metromap` dans VS Code.
2. Lance un serveur local (ex: Live Server) a la racine du projet.
3. Ouvre `admin-app/index.html` dans le navigateur.

## Workflow recommande

1. Charge un brouillon local ou importe un JSON existant.
2. Modifie stations, lignes et style d'affichage.
3. Clique sur `Exporter JSON pour le site`.
4. Remplace le fichier `data/metro-network.json` avec le JSON exporte.
5. Recharge `index.html` et `route.html` pour voir la nouvelle configuration.
