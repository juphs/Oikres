-- Initial payment: the total a new tenant pays the first time they move in. Empty = work it out from rent plus charges.
ALTER TABLE listing_units ADD COLUMN initial_payment INTEGER CHECK (initial_payment IS NULL OR initial_payment >= 0);
