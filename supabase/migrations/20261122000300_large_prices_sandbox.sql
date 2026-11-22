-- Prezzi sandbox della fascia Grande (listino a fasce, 22/11): 89 € al mese e
-- 890 € all'anno, creati su Paddle sandbox il 22/11. Le fasce Piccola e Media
-- tengono i prezzi di Base e Team (stessi id, stessi importi). I prezzi live
-- arriveranno con la loro migration, quando esisterà l'account live.
insert into private.billing_prices (environment, price_id, item, billing_interval) values
  ('sandbox', 'pri_01m81x936fptc7ptqzj4qxg1zn', 'large', 'month'),
  ('sandbox', 'pri_01m81xan232jp2m00fa9j44kmp', 'large', 'year');
