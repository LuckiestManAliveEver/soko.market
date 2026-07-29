# Agent Evaluation and Feedback Loop

## Purpose

Evaluation improves runtime configuration and routing without training model weights. Events are
shop-scoped, versioned, and associated with the model used so owners and operators can distinguish a
policy problem from a model or tool problem.

## Recorded signals

The event contract supports intent classification, context retrieval, tool selection/execution,
policy compliance, customer and owner corrections, completed sales, abandoned orders, escalation,
unsupported requests, latency, model failures, hallucinated products or prices, invalid discounts,
customer satisfaction, and owner feedback.

Each event stores its tenant/shop/agent binding, outcome, optional score and bounded reason,
privacy-safe metadata, runtime version, model ID, and timestamp. Hidden chain-of-thought and private
model reasoning are never stored.

Runtime turns currently record an outcome event containing bounded operational metadata such as
intent, tool, status, and latency. Correct/incorrect controls on agent messages record explicit owner
feedback. The settings profile shows aggregate success, blocked, and failure counts.

## Owner corrections

An owner can add a correction as an instruction, business fact, memory, or response correction.
Corrections can remain bounded runtime memory or be promoted into structured general operating rules.
Promotion creates a new runtime version. Disabled corrections are excluded from retrieval and retain
their audit history.

Corrections are not model fine-tuning. They improve the compiled runtime immediately and remain
available when the underlying model changes.

## Retention and privacy

The evaluation and memory policies include enablement, sampling, retention days, customer-consent
requirements, and per-scope limits. Customer conversation memory is off by default. Evaluation
summaries are owner-only and are not rendered in customer storefronts.

Automatic retention cleanup and reusable-workflow promotion are not yet background jobs. The
policies and durable event structures are in place for those lifecycle workers.
