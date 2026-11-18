-- IcaMeal package pricing update.
-- The annual package stays for historical purchase references but cannot be purchased.

begin;

update public.products
set price_idr = 25000,
    description = 'Akses The Good Food Club selama 30 hari.',
    is_active = true,
    display_order = 1
where code = 'good_food_club_monthly';

update public.products
set is_active = false,
    display_order = 2
where code = 'good_food_club_yearly';

update public.products
set price_idr = 15000,
    description = 'Koleksi 30 resep premium, sekali beli.',
    is_active = true,
    display_order = 3
where code = 'recipe_book_30';

update public.products
set price_idr = 10000,
    description = 'Kalender menu 30 hari dan akses penuh meal plan mingguan, sekali beli.',
    is_active = true,
    duration_days = 30,
    display_order = 4
where code = 'meal_plan_30_days';

commit;
