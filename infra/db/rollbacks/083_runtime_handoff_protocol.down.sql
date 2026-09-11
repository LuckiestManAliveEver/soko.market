drop trigger if exists cp2_runtime_handoffs_immutable_guard on cp2_runtime_handoffs;
drop function if exists cp2_runtime_handoffs_immutable_guard();

drop table if exists cp2_runtime_operation_dedup;
drop table if exists cp2_runtime_task_instances;
drop table if exists cp2_runtime_task_heads;
drop table if exists cp2_runtime_handoffs;
