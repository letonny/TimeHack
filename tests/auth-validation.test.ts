import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCredentials } from '../lib/auth-validation.ts';
import { authRedirect } from '../lib/auth-routes.ts';

test('email and password validation rejects missing and malformed credentials', () => {
  assert.equal(validateCredentials('', 'password'), 'Enter a valid email address.');
  assert.equal(validateCredentials('not-an-email', 'password'), 'Enter a valid email address.');
  assert.equal(validateCredentials('person@example.com', ''), 'Enter your password.');
});

test('route policy protects dashboard and keeps auth pages public', () => {
  assert.equal(authRedirect('/', false), '/login');
  assert.equal(authRedirect('/', true), null);
  assert.equal(authRedirect('/login', false), null);
  assert.equal(authRedirect('/signup', false), null);
  assert.equal(authRedirect('/login', true), '/');
  assert.equal(authRedirect('/signup', true), '/');
});

test('signup enforces minimum password length while login accepts existing passwords', () => {
  assert.equal(validateCredentials('person@example.com', 'short', true), 'Use a password with at least 6 characters.');
  assert.equal(validateCredentials('person@example.com', 'short'), null);
  assert.equal(validateCredentials(' person@example.com ', 'long-enough', true), null);
});
