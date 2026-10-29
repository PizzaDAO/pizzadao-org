export const title = 'Organiser une fête'
export const dek = 'Comment organiser une fête pizza PizzaDAO : la préparer, la budgéter, l\'annoncer, la tenir et être remboursé.'
export const reviewed = '2026-10'

export const body = String.raw`
Tout le monde peut organiser une fête PizzaDAO : quelques amis, une pizzeria, un lieu communautaire. Cette page couvre tout le parcours. Si tu débutes, lis d'abord [premiers pas](/handbook/getting-started) et rejoins un appel de la crew événements.

## Avant de commencer {#before}

1. **Choisis un lieu et une date.** Une pizzeria, un bar avec cuisine, un espace de coworking ou un parc conviennent. Prends un endroit avec un four à proximité ou une option de livraison.
2. **Trouve des co-hôtes.** Organiser à deux ou trois partage le travail. Une pizzeria locale est un excellent partenaire.
3. **Préviens la crew événements.** Dis dans quelle ville tu es et quand. Elle peut te mettre en relation avec d'autres hôtes et répondre à tes questions.
4. **Crée une page pour les invités.** Fais une page d'événement sur rsv.pizza pour que les gens confirment leur venue, et pour que ta fête compte dans les missions qui en demandent une.
5. **Publie-la.** Ajoute ta fête à la liste des événements de la communauté pour que les gens du coin la trouvent.

::if eventsUrl
Tu peux publier ta fête sur le [site des événements]({{eventsUrl}}).
::end

::if hostPlaybookUrl
Il existe aussi un [guide de l'hôte]({{hostPlaybookUrl}}) plus long avec des conseils en plus.
::end

## Budget {#budget}

Prépare un budget simple avant de dépenser : pizzas, boissons, frais de lieu s'il y en a, et impression. Copie le modèle de budget, remplis-le et partage-le avec la crew événements pour validation. Une dépense non validée au préalable peut ne pas être remboursée.

::if hostCapUsd
La DAO peut contribuer jusqu'à {{hostCapUsd}} pour une fête organisée.
::end

::if budgetTemplateUrl
[Ouvre le modèle de budget]({{budgetTemplateUrl}}) et fais ta propre copie.
::end

Les pizzerias sponsorisent souvent une partie de la fête. Si c'est le cas, indique-le dans ton budget pour que la contribution de la DAO puisse être plus petite.

## Le calcul des pizzas {#pizza-math}

Ne commande pas tout d'un coup. Commande par vagues, environ toutes les 45 minutes, pour que les pizzas arrivent chaudes. Compte à peu près une pizza pour une personne et demie, avec des options végétariennes et véganes. Mieux vaut recommander que manquer ou jeter des pizzas.

## Créer un POAP {#poaps}

Un POAP est un badge de collection que les invités peuvent récupérer pour prouver qu'ils étaient là. En créer un pour ta fête est un joli geste, et c'est aussi l'une des missions. Les étapes sont dans [créer un POAP](/handbook/make-a-poap).

## Annonce ta fête {#announce}

Préviens tôt et plusieurs fois. Publie la page de l'événement sur tes réseaux, partage-la sur le Discord de la communauté et demande à la crew communication de l'aide pour un message ou un visuel. Mentionne les comptes officiels pour que la communauté la relaie aussi.

::if hashtags
Utilise ces hashtags : {{hashtags}}
::end

## Le jour J {#day-of}

- Arrive tôt, vérifie le four ou la commande, et installe une table d'accueil.
- Accueille les gens à la porte. Certains invités ne connaîtront personne.
- Rejoins l'appel de la communauté s'il y en a un mondial ce jour-là, et montre ta fête à l'écran.
- Prends des photos et une courte vidéo. Demande l'accord des invités avant de publier leur visage.
- Garde tous les reçus, même pour les petits achats.

## Après la fête {#after}

1. **Rassemble tes reçus** et note ce qui a été dépensé par rapport à ton budget validé.
2. **Demande le remboursement.** Les exigences de paiement peuvent varier selon le pays : demande à la crew événements si tu ne sais pas ce qu'il faut.
3. **Partage un compte rendu.** Publie tes photos et quelques lignes sur le déroulé sur Discord et sur les réseaux sociaux.
4. **Remercie** ton lieu, tes co-hôtes et tes invités.

::if paymentFormUrl
Envoie ta demande de remboursement avec le [formulaire de paiement]({{paymentFormUrl}}).
::end

::if gppDate
## Global Pizza Party {#gpp}

La prochaine Global Pizza Party a lieu le {{gppDate}}. Des fêtes du monde entier célèbrent ensemble le même jour.

C'est l'édition {{gppEdition}}.
::end

::if hostDeadlines
## Échéances {#deadlines}

{{hostDeadlines}}
::end
`
