import { faker } from '@faker-js/faker';

// Generates random test data using ##FieldName syntax. Supports 15 common fields.
export class RandomDataGenerator {
  private static generatedValues: Map<string, string> = new Map();

  static resolve(value: string): string {
    return value.replace(/##(\w+)/g, (_, field) => {
      const generated = this.generate(field);
      this.generatedValues.set(field, generated);
      return generated;
    });
  }

  static generate(field: string): string {
    switch (field) {
      case 'FirstName':
        return faker.person.firstName();
      case 'LastName':
        return faker.person.lastName();
      case 'FullName':
        return faker.person.fullName();
      case 'Email':
        return faker.internet.email();
      case 'MobileNum':
        return faker.phone.number({ style: 'national' }).replace(/\D/g, '').slice(0, 10);
      case 'PhoneNum':
        return faker.phone.number({ style: 'national' }).replace(/\D/g, '').slice(0, 10);
      case 'Address':
        return faker.location.streetAddress();
      case 'City':
        return faker.location.city();
      case 'State':
        return faker.location.state();
      case 'ZipCode':
        return faker.location.zipCode('#####');
      case 'Country':
        return faker.location.country();
      case 'Company':
        return faker.company.name();
      case 'JobTitle':
        return faker.person.jobTitle();
      case 'Username':
        return faker.internet.username();
      case 'Password':
        return faker.internet.password({ length: 12 });
      case 'DOB':
        return faker.date.birthdate({ min: 18, max: 60, mode: 'age' }).toISOString().split('T')[0];
      case 'SSN':
        return faker.string.numeric(9);
      case 'CreditCard':
        return faker.finance.creditCardNumber();
      case 'Amount':
        return faker.finance.amount({ min: 10, max: 9999, dec: 2 });
      case 'UUID':
        return faker.string.uuid();
      default:
        return faker.string.alphanumeric(10);
    }
  }

  static getLastGenerated(field: string): string | undefined {
    return this.generatedValues.get(field);
  }

  static clear(): void {
    this.generatedValues.clear();
  }
}
