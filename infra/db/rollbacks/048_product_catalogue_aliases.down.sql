drop index if exists products_business_name_lower_idx;
alter table products drop column if exists aliases;
