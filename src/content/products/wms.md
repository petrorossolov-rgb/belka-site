---
name: Belka WMS
# Тексты утверждены владельцем 2026-09-27: docs/ep03-product-wms/log.md → «Утверждение текстов: wms»
# (пакет texts/wms.md, коммит d0f9394). Правка — новым циклом runbook, не напрямую.
descriptor: "система управления складом"
short: WMS
domain: warehouse
kind: platform
mapOrder: 1
summary: "Система управления складом: приёмка, хранение, резервирование, отбор, упаковка и отгрузка для 3PL, ритейла, фулфилмента и производства."
hasPage: true
# Страница /products/wms/ опубликована в ep03 (T22).
pageDraft: false
featured: true
lead: "Belka WMS — система управления складом для 3PL, ритейла, фулфилмента и складов при производстве, в том числе когда профили сочетаются на одном складе. Ведёт приёмку, хранение, резервирование, отбор, упаковку и отгрузку, сохраняет историю движений товара и работает в закрытом контуре."
readiness: in-development  # скрыто: выводится только при site.flags.showReadiness
draft: false
# OG-карточка: npm run build:og -- --product wms (ep03 T20).
ogImage: ../../assets/og/wms.png
ogImageAlt: "Знак Belka SCM и подпись «Belka WMS — система управления складом» на рыжей плашке"
seo:
  title: "Belka WMS: система управления складом"
  description: "Belka WMS — система управления складом для 3PL, ритейла, фулфилмента и производства: веб-консоль, ТСД и упаковочный стол. Работает в закрытом контуре."
# Страница продукта — герой и секции; тела нет (правило целостности).
sections: [wms-fit, wms-surfaces, wms-scope, wms-deploy, wms-exchange, wms-spec, approach, platform]
---
