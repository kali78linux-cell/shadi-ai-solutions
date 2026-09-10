-- Flexible service pricing (additive, non-breaking).
-- pricing_type: unspecified | fixed | estimate | range | case_by_case
-- Legacy `price` stays; code treats price = 0 / null as "unspecified".
alter table clinic_services
  add column if not exists pricing_type text not null default 'unspecified'
    check (pricing_type in ('unspecified','fixed','estimate','range','case_by_case'));
alter table clinic_services add column if not exists price_min numeric(10,2);
alter table clinic_services add column if not exists price_max numeric(10,2);
alter table clinic_services add column if not exists price_visible_to_patients boolean not null default true;

-- Backfill: any existing non-zero explicit price is a fixed price.
update clinic_services set pricing_type = 'fixed' where price is not null and price > 0 and pricing_type = 'unspecified';
