---
name: Belka PackApp
# Тексты утверждены владельцем 2026-09-27: docs/ep04-product-packapp/log.md → «Утверждение текстов:
# packapp» (пакет texts/packapp.md, коммит 594e3d9). Правка — новым циклом runbook, не напрямую.
# Страница /products/packapp/ — ep04, черновая до T17; summary и lead утверждены в ep02.
descriptor: "стол упаковки и маркировки"
short: PackApp
domain: packing
kind: standalone
hasPage: true
pageDraft: false
summary: "Стол упаковки и маркировки: ведёт упаковщика по заказу, сверяет каждый скан и печатает этикетки. Работает с любой WMS."
featured: true
lead: "Belka PackApp — стол упаковки и маркировки для склада, который остаётся на своей WMS. Ведёт упаковщика по заказу, сверяет каждый скан, поддерживает коды маркировки и требования маркетплейсов, проверяет этикетку обратным сканом. Работает у крупного фулфилмент-оператора."
readiness: available  # скрыто: выводится только при site.flags.showReadiness
# OG-карточка: npm run build:og -- --product packapp (ep04 T14).
ogImage: ../../assets/og/packapp.png
ogImageAlt: "Знак Belka SCM и подпись «Belka PackApp — стол упаковки и маркировки» на рыжей плашке"
# Страница продукта — герой и секции; тела нет (правило целостности 1).
sections: [packapp-fit, packapp-surfaces, packapp-control, packapp-marking, packapp-connect]
seo:
  description: "Belka PackApp — стол упаковки и маркировки: ведёт упаковщика по заказу, сверяет каждый скан, поддерживает коды маркировки и проверяет этикетку обратным сканом."
---
